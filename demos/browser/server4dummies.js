const AWS = require('aws-sdk');
const compression = require('compression');
const fs = require('fs');
const http = require('http');
const url = require('url');
const { v4: uuidv4 } = require('uuid');

// Guarda todas las reuniones creadas para que la gente se pueda unir con el meeting title
const meetingTable = {};

// Carga la aplicacion web que se usa como index desde el env
const app = process.env.npm_config_app || 'meetingV2';
const indexPagePath = `dist/${app}.html`;

// Lee la pagina index
const indexPage = fs.readFileSync(indexPagePath);

// Configura el endpoint de Chime The Chime endpoint is https://service.chime.aws.amazon.com.
const endpoint = process.env.ENDPOINT || 'https://service.chime.aws.amazon.com';
const currentRegion = process.env.REGION || 'us-west-2';
const useChimeSDKMeetings = process.env.USE_CHIME_SDK_MEETINGS || 'true';

// Crea objeto de Chime. Se supone que us-east-1 es global, no estoy seguro si hay en otras regiones
// Se usa MediaRegion en CreateMeeting para seleccionar la region de la reunion
const chime = new AWS.Chime({ region: 'us-east-1' });
chime.endpoint = endpoint; // Ponerle el endpoint al objeto de chime

// Crea objeto de Chime SDK. No se que difeerencia hay entre el objeto de Chime y el de SDK
const chimeSDKMeetings = new AWS.ChimeSDKMeetings({ region: currentRegion });
if (endpoint !== 'https://service.chime.aws.amazon.com') {
  chimeSDKMeetings.endpoint = endpoint; // Ponerle el endpoint
}

// Objeto sts que permite pedir credenciales para un usuario de IAM
const sts = new AWS.STS({ region: 'us-east-1' })

// Lugar de bucket S3 que se usa para captura. Creo que esto es para la grabacion de la reunion
const captureS3Destination = "arn:aws:s3:::chimesdk-recordings-gpo501";
if (captureS3Destination) {
  console.info(`S3 destination for capture is ${captureS3Destination}`)
} else {
  console.info(`S3 destination for capture not set.  Cloud media capture will not be available.`)
}

// Regresa el objeto de la reunion de Chime.
// Con esta funcion obtienes la referencia a la reunion y aqui haces todos los metodos para la reunion
// tipo cliente.CreateMeeting, client.DeleteAtendee
function getClientForMeeting(meeting) {
    return useChimeSDKMeetings === "true" ||
      (meeting &&
        meeting.Meeting &&
        meeting.Meeting.MeetingFeatures &&
        meeting.Meeting.MeetingFeatures.Audio &&
        meeting.Meeting.MeetingFeatures.Audio.EchoReduction === "AVAILABLE")
      ? chimeSDKMeetings
      : chime;
  }

/*
 * Crea un servidor HTTP en localhost para la pagina dummy del demo y las acciones de la reunion
 * Esto en teoria no deberia de ir en la version final. Ya que todo se corre en nuestra app de AWS.
 * Creo que lo que deberia pasar aqui es enlazar con nuestra app pero no se como.
 * Aqui veo que el meeting al que te quieres unir ya viene en el URL como en zoom
 * porque abajo hay lineas que ya te meten a la reunion o la crean si no existe.
 * 
 * 
 * Conclusiones, aqui se definen todas las rutas que hay en la llamada. Esto creo que en vez de 
 * crear un server en localhost, tenemos que enlazar con nuestra app. Pero la parte de todas las
 * rutas si deberia de estar.
 */
function serve(host = '127.0.0.1:8080') {
// Start an HTTP server to serve the index page and handle meeting actions
    http.createServer({}, async (request, response) => {
        log(`${request.method} ${request.url} BEGIN`);
        try {
        // Enable HTTP compression
        compression({})(request, response, () => {});
        // URL con la que se hizo la peticion
        const requestUrl = url.parse(request.url, true);
        if (request.method === 'GET' && requestUrl.pathname === '/') {
            // Return the contents of the index page
            respond(response, 200, 'text/html', indexPage);
        } else if (process.env.DEBUG) {
            // For internal debugging - ignore this
            const debug = require('./debug.js');
            const debugResponse = debug.debug(request);
            respond(response, debugResponse.status, 'application/json', JSON.stringify(debugResponse.response, null, 2));




            //La URL dice que se quiere unir a una sesion
        } else if (request.method === 'POST' && requestUrl.pathname === '/join') {
            if (!requestUrl.query.title || !requestUrl.query.name) {
            respond(response, 400, 'application/json', JSON.stringify({ error: 'Need parameters: title and name' }));
            }
            let client = getClientForMeeting(meetingTable[requestUrl.query.title]);

            // Look up the meeting by its title. If it does not exist, create the meeting.
            if (!meetingTable[requestUrl.query.title]) {
                if (!requestUrl.query.region) {
                    respond(response, 400, 'application/json', JSON.stringify({ error: 'Need region parameter set if meeting has not yet been created' }));
                }
                let request = {
                    // Use a UUID for the client request token to ensure that any request retries
                    // do not create multiple meetings.
                    ClientRequestToken: uuidv4(),
                    // Specify the media region (where the meeting is hosted).
                    // In this case, we use the region selected by the user.
                    MediaRegion: requestUrl.query.region,
                    // Any meeting ID you wish to associate with the meeting.
                    // For simplicity here, we use the meeting title.
                    ExternalMeetingId: requestUrl.query.title.substring(0, 64),
                };

            let primaryMeeting = undefined;
            if (requestUrl.query.primaryExternalMeetingId) {
                primaryMeeting = meetingTable[requestUrl.query.primaryExternalMeetingId]
                if (primaryMeeting !== undefined) {
                log(`Retrieved primary meeting ID ${primaryMeeting.Meeting.MeetingId} for external meeting ID ${requestUrl.query.primaryExternalMeetingId}`)
                request.PrimaryMeetingId = primaryMeeting.Meeting.MeetingId;
                } else {
                respond(response, 400, 'application/json', JSON.stringify({ error: 'Primary meeting has not been created' }));
                }
            }

            if (requestUrl.query.ns_es === 'true') {
                client = chimeSDKMeetings;
                request.MeetingFeatures = {
                Audio: {
                    // The EchoReduction parameter helps the user enable and use Amazon Echo Reduction.
                    EchoReduction: 'AVAILABLE'
                }
                };
            }
            let meeting = await client.createMeeting(request).promise();

            // Extend meeting with primary external meeting ID if it exists
            if (primaryMeeting !== undefined) {
                meeting.Meeting.PrimaryExternalMeetingId = primaryMeeting.Meeting.ExternalMeetingId;
            }

            meetingTable[requestUrl.query.title] = meeting;
            }

            // Fetch the meeting info
            const meeting = meetingTable[requestUrl.query.title];

            // Create new attendee for the meeting
            const attendee = await client.createAttendee({
            // The meeting ID of the created meeting to add the attendee to
            MeetingId: meeting.Meeting.MeetingId,

            // Any user ID you wish to associate with the attendeee.
            // For simplicity here, we use a random id for uniqueness
            // combined with the name the user provided, which can later
            // be used to help build the roster.
            ExternalUserId: `${uuidv4().substring(0, 8)}#${requestUrl.query.name}`.substring(0, 64),
            }).promise();

            /*
             * Esto es lo que se le tiene que regresar al agente
             */
            // Return the meeting and attendee responses. The client will use these
            // to join the meeting.
            let joinResponse = {
            JoinInfo: {
                Meeting: meeting,
                Attendee: attendee,
            },
            }
            if (meeting.Meeting.PrimaryExternalMeetingId !== undefined) {
            // Put this where it expects it, since it is not technically part of create meeting response
            joinResponse.JoinInfo.PrimaryExternalMeetingId = meeting.Meeting.PrimaryExternalMeetingId;
            }
            respond(response, 201, 'application/json', JSON.stringify(joinResponse, null, 2));
















            // La peticion de la URL es terminar la sesion
        } else if (request.method === 'POST' && requestUrl.pathname === '/end') {
            // End the meeting. All attendee connections will hang up.
            let client = getClientForMeeting(meetingTable[requestUrl.query.title]);

            await client.deleteMeeting({
            MeetingId: meetingTable[requestUrl.query.title].Meeting.MeetingId,
            }).promise();
            respond(response, 200, 'application/json', JSON.stringify({}));














            // URL para empezar a capturar con Media Capture Pipeline
        } else if (request.method === 'POST' && requestUrl.pathname === '/startCapture') {
            if (captureS3Destination) {
            const callerInfo = await sts.getCallerIdentity().promise()

            // Creacion del Media Capture Pipeline. Esto se usa para grabar la reunion
            pipelineInfo = await chime.createMediaCapturePipeline({
                SourceType: "ChimeSdkMeeting",
                SourceArn: `arn:aws:chime::${callerInfo.Account}:meeting:${meetingTable[requestUrl.query.title].Meeting.MeetingId}`,
                SinkType: "S3Bucket",
                SinkArn: captureS3Destination,
            }).promise();
            meetingTable[requestUrl.query.title].Capture = pipelineInfo.MediaCapturePipeline;
            respond(response, 201, 'application/json', JSON.stringify(pipelineInfo));
            } else {
            console.warn("Cloud media capture not available")
            respond(response, 500, 'application/json', JSON.stringify({}))
            }
















            //URL dice que borres a un atendiente
        } else if (request.method === 'POST' && requestUrl.pathname === '/deleteAttendee') {
            if (!requestUrl.query.title || !requestUrl.query.attendeeId) {
            throw new Error('Need parameters: title, attendeeId');
            }
            let client = getClientForMeeting(meetingTable[requestUrl.query.title]);

            // Fetch the meeting info
            const meeting = meetingTable[requestUrl.query.title];

            await client.deleteAttendee({
            MeetingId: meeting.Meeting.MeetingId,
            AttendeeId: requestUrl.query.attendeeId,
            }).promise();

            respond(response, 201, 'application/json', JSON.stringify({}));


            









            // URL dice que termines la captura. Esto es lo de los Media Capture Pipelines
        } else if (request.method === 'POST' && requestUrl.pathname === '/endCapture') {
            if (captureS3Destination) {
            pipelineInfo = meetingTable[requestUrl.query.title].Capture;
            await chime.deleteMediaCapturePipeline({
                MediaPipelineId: pipelineInfo.MediaPipelineId
            }).promise();
            meetingTable[requestUrl.query.title].Capture = undefined;
            respond(response, 200, 'application/json', JSON.stringify({}));
            } else {
            console.warn("Cloud media capture not available")
            respond(response, 500, 'application/json', JSON.stringify({}))
            }













            //URL dice que hay que terminar la reunion. No se porque hay 2 de /end
            //Los dos tienen el mismo codigo
        } else if (request.method === 'POST' && requestUrl.pathname === '/end') {
            // End the meeting. All attendee connections will hang up.
            let client = getClientForMeeting(meetingTable[requestUrl.query.title]);

            await client.deleteMeeting({
            MeetingId: meetingTable[requestUrl.query.title].Meeting.MeetingId,
            }).promise();
            respond(response, 200, 'application/json', JSON.stringify({}));














            // URL para empezar la transcripcion de la reunion
            // Esto no lo necesitamos ya que esto ya lo hace Connect
        } else if (request.method === 'POST' && requestUrl.pathname === '/start_transcription') {
            const languageCode = requestUrl.query.language;
            const region = requestUrl.query.region;
            let transcriptionConfiguration = {};
            let transcriptionStreamParams = {};
            if (requestUrl.query.transcriptionStreamParams) {
            transcriptionStreamParams = JSON.parse(requestUrl.query.transcriptionStreamParams);
            }
            const contentIdentification = requestUrl.query.contentIdentification;
            const piiEntityTypes = requestUrl.query.piiEntityTypes;
            if (requestUrl.query.engine === 'transcribe') {
            transcriptionConfiguration = {
                EngineTranscribeSettings: {}
            };
            if (languageCode) {
                transcriptionConfiguration.EngineTranscribeSettings.LanguageCode = languageCode;
            }
            if (region) {
                transcriptionConfiguration.EngineTranscribeSettings.Region = region;
            }
            if (transcriptionStreamParams.hasOwnProperty('contentIdentificationType')) {
                transcriptionConfiguration.EngineTranscribeSettings.ContentIdentificationType = transcriptionStreamParams.contentIdentificationType;
            }
            if (transcriptionStreamParams.hasOwnProperty('contentRedactionType')) {
                transcriptionConfiguration.EngineTranscribeSettings.ContentRedactionType = transcriptionStreamParams.contentRedactionType;
            }
            if (transcriptionStreamParams.hasOwnProperty('enablePartialResultsStability')) {
                transcriptionConfiguration.EngineTranscribeSettings.EnablePartialResultsStabilization = transcriptionStreamParams.enablePartialResultsStability;
            }
            if (transcriptionStreamParams.hasOwnProperty('partialResultsStability')) {
                transcriptionConfiguration.EngineTranscribeSettings.PartialResultsStability = transcriptionStreamParams.partialResultsStability;
            }
            if (transcriptionStreamParams.hasOwnProperty('piiEntityTypes')) {
                transcriptionConfiguration.EngineTranscribeSettings.PiiEntityTypes = transcriptionStreamParams.piiEntityTypes;
            }
            if (transcriptionStreamParams.hasOwnProperty('languageModelName')) {
                transcriptionConfiguration.EngineTranscribeSettings.LanguageModelName = transcriptionStreamParams.languageModelName;
            }
            if (transcriptionStreamParams.hasOwnProperty('identifyLanguage')) {
                transcriptionConfiguration.EngineTranscribeSettings.IdentifyLanguage = transcriptionStreamParams.identifyLanguage;
            }
            if (transcriptionStreamParams.hasOwnProperty('languageOptions')) {
                transcriptionConfiguration.EngineTranscribeSettings.LanguageOptions = transcriptionStreamParams.languageOptions;
            }
            if (transcriptionStreamParams.hasOwnProperty('preferredLanguage')) {
                transcriptionConfiguration.EngineTranscribeSettings.PreferredLanguage = transcriptionStreamParams.preferredLanguage;
            }
            } else if (requestUrl.query.engine === 'transcribe_medical') {
            transcriptionConfiguration = {
                EngineTranscribeMedicalSettings: {
                LanguageCode: languageCode,
                Specialty: 'PRIMARYCARE',
                Type: 'CONVERSATION',
                }
            };
            if (region) {
                transcriptionConfiguration.EngineTranscribeMedicalSettings.Region = region;
            }
            if (transcriptionStreamParams.hasOwnProperty('contentIdentificationType')) {
                transcriptionConfiguration.EngineTranscribeMedicalSettings.ContentIdentificationType = transcriptionStreamParams.contentIdentificationType;
            }
            } else {
            return response(400, 'application/json', JSON.stringify({
                error: 'Unknown transcription engine'
            }));
            }
            let client = getClientForMeeting(meetingTable[requestUrl.query.title]);

            await client.startMeetingTranscription({
            MeetingId: meetingTable[requestUrl.query.title].Meeting.MeetingId,
            TranscriptionConfiguration: transcriptionConfiguration
            }).promise();
            respond(response, 200, 'application/json', JSON.stringify({}));
        
        






            //URL para terminar la transcripcion de la reunion.
            // Esto no lo necesitamos, ya lo hace Connect
        } else if (request.method === 'POST' && requestUrl.pathname === '/stop_transcription') {
            let client = getClientForMeeting(meetingTable[requestUrl.query.title]);

            await client.stopMeetingTranscription({
            MeetingId: meetingTable[requestUrl.query.title].Meeting.MeetingId
            }).promise();
            respond(response, 200, 'application/json', JSON.stringify({}));













            // URL para autenticacion. Esto creo que te da lo que pusiste en el CLI???
            // O no se a donde se va cuando le das AWS.config.credentials, hay que investigar eso
        } else if (request.method === 'GET' && requestUrl.pathname === '/fetch_credentials') {
            const awsCredentials = {
            accessKeyId: AWS.config.credentials.accessKeyId,
            secretAccessKey: AWS.config.credentials.secretAccessKey,
            sessionToken: AWS.config.credentials.sessionToken,
            };
            respond(response, 200, 'application/json', JSON.stringify(awsCredentials), true);
















            // URL para mandar archivos de audio. La verdad no se para que quisieras esto pero aqui esta
            // speech.mp3 es un speech de obama acerca de la migracion (fuera de pedo, neta es eso)
            // speech_stereo.mp3 es una prueba de tu audio stereo
        } else if (request.method === 'GET' && (requestUrl.pathname === '/audio_file' || requestUrl.pathname === '/stereo_audio_file')) {
            let filePath = 'dist/speech.mp3';
            if (requestUrl.pathname === '/stereo_audio_file') {
            filePath = 'dist/speech_stereo.mp3';
            }
            fs.readFile(filePath, { encoding: 'base64' }, function (err, data) {
            if (err) {
                log(`Error reading audio file ${filePath}: ${err}`)
                respond(response, 404, 'application/json', JSON.stringify({}));
                return;
            }
            respond(response, 200, 'audio/mpeg', data);
            });













            // Si todo falla, un buen 404
        } else {
            respond(response, 404, 'text/html', '404 Not Found');
        }







        } catch (err) {
        respond(response, 400, 'application/json', JSON.stringify({ error: err.message }, null, 2));
        }
        log(`${request.method} ${request.url} END`);










        // Lanza el server
    }).listen(host.split(':')[1], host.split(':')[0], () => {
        log(`server running at http://${host}/`);
    });
    }