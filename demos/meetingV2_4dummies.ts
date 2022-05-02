import './styleV2.scss';

//Imports
import {
  ApplicationMetadata,
  AsyncScheduler,
  Attendee,
  AudioInputDevice,
  AudioProfile,
  AudioVideoFacade,
  AudioVideoObserver,
  BackgroundBlurProcessor,
  BackgroundBlurVideoFrameProcessor,
  BackgroundBlurVideoFrameProcessorObserver,
  BackgroundReplacementProcessor,
  BackgroundReplacementVideoFrameProcessor,
  BackgroundReplacementVideoFrameProcessorObserver,
  BackgroundReplacementOptions,
  ClientMetricReport,
  ConsoleLogger,
  ContentShareObserver,
  DataMessage,
  DefaultActiveSpeakerPolicy,
  DefaultAudioVideoController,
  DefaultBrowserBehavior,
  DefaultDeviceController,
  DefaultMeetingEventReporter,
  DefaultMeetingSession,
  DefaultModality,
  DefaultVideoTransformDevice,
  Device,
  DeviceChangeObserver,
  EventAttributes,
  EventIngestionConfiguration,
  EventName,
  EventReporter,
  LogLevel,
  Logger,
  MeetingEventsClientConfiguration,
  MeetingSession,
  MeetingSessionConfiguration,
  MeetingSessionStatus,
  MeetingSessionStatusCode,
  MeetingSessionVideoAvailability,
  MultiLogger,
  NoOpEventReporter,
  NoOpVideoFrameProcessor,
  RemovableAnalyserNode,
  SimulcastLayers,
  Transcript,
  TranscriptEvent,
  TranscriptionStatus,
  TranscriptionStatusType,
  TranscriptItemType,
  TranscriptResult,
  Versioning,
  VideoDownlinkObserver,
  VideoFrameProcessor,
  VideoInputDevice,
  VideoPriorityBasedPolicy,
  VideoPriorityBasedPolicyConfig,
  VoiceFocusDeviceTransformer,
  VoiceFocusModelComplexity,
  VoiceFocusModelName,
  VoiceFocusPaths,
  VoiceFocusSpec,
  VoiceFocusTransformDevice,
  isAudioTransformDevice,
  isDestroyable,
  BackgroundFilterSpec,
  BackgroundFilterPaths,
  ModelSpecBuilder,
  DefaultEventController,
  MeetingSessionCredentials,
  POSTLogger,
} from 'amazon-chime-sdk-js';

import TestSound from './audio/TestSound';
import MeetingToast from './util/MeetingToast'; MeetingToast; // Make sure this file is included in webpack
import VideoTileCollection from './video/VideoTileCollection'
import VideoPreferenceManager from './video/VideoPreferenceManager';
import CircularCut from './video/filters/CircularCut';
import EmojifyVideoFrameProcessor from './video/filters/EmojifyVideoFrameProcessor';
import SegmentationProcessor from './video/filters/SegmentationProcessor';
import ResizeProcessor from './video/filters/ResizeProcessor';
import {
  loadBodyPixDependency,
  platformCanSupportBodyPixWithoutDegradation,
} from './video/filters/SegmentationUtil';
import SyntheticVideoDeviceFactory from './video/SyntheticVideoDeviceFactory';
import { getPOSTLogger } from './util/MeetingLogger';


let SHOULD_EARLY_CONNECT = (() => {
    return document.location.search.includes('earlyConnect=1');
  })();
  
  let SHOULD_DIE_ON_FATALS = (() => {
    const isLocal = document.location.host === '127.0.0.1:8080' || document.location.host === 'localhost:8080';
    const fatalYes = document.location.search.includes('fatal=1');
    const fatalNo = document.location.search.includes('fatal=0');
    return fatalYes || (isLocal && !fatalNo);
  })();

export let fatal: (e: Error) => void;

// This shim is needed to avoid warnings when supporting Safari.
declare global {
    interface Window {
      webkitAudioContext: typeof AudioContext
    }
}

/*
 * Voice Focus es para reducir el sonido ambiental
 * No se deberia de usar ya que a nosotros no nos importa el audio de Chime, solo la pantalla
// Support a set of query parameters to allow for testing pre-release versions of
// Amazon Voice Focus. If none of these parameters are supplied, the SDK default
// values will be used.
const search = new URLSearchParams(document.location.search);
const VOICE_FOCUS_NAME = search.get('voiceFocusName') || undefined;
const VOICE_FOCUS_CDN = search.get('voiceFocusCDN') || undefined;
const VOICE_FOCUS_ASSET_GROUP = search.get('voiceFocusAssetGroup') || undefined;
const VOICE_FOCUS_REVISION_ID = search.get('voiceFocusRevisionID') || undefined;

const VOICE_FOCUS_PATHS: VoiceFocusPaths | undefined = VOICE_FOCUS_CDN && {
  processors: `${VOICE_FOCUS_CDN}processors/`,
  wasm: `${VOICE_FOCUS_CDN}wasm/`,
  workers: `${VOICE_FOCUS_CDN}workers/`,
  models: `${VOICE_FOCUS_CDN}wasm/`,
};

function voiceFocusName(name: string | undefined = VOICE_FOCUS_NAME): VoiceFocusModelName | undefined {
  if (name && ['default', 'ns_es'].includes(name)) {
    return name as VoiceFocusModelName;
  }
  return undefined;
}

const VOICE_FOCUS_SPEC = {
  name: voiceFocusName(),
  assetGroup: VOICE_FOCUS_ASSET_GROUP,
  revisionID: VOICE_FOCUS_REVISION_ID,
  paths: VOICE_FOCUS_PATHS,
};

function getVoiceFocusSpec(joinInfo: any): VoiceFocusSpec {
  const es = joinInfo.Meeting.Meeting?.MeetingFeatures?.Audio?.EchoReduction === 'AVAILABLE';
  let spec: VoiceFocusSpec = VOICE_FOCUS_SPEC;
  if (!spec.name) {
    spec.name = es ? voiceFocusName('ns_es') : voiceFocusName('default');
  }
  return spec;
};

const MAX_VOICE_FOCUS_COMPLEXITY: VoiceFocusModelComplexity | undefined = undefined;
*/

/*
 * Seccion para filtros y fondos de pantalla.
 * No lo utilizamos ya que no nos importa el video del agente
const BACKGROUND_BLUR_CDN = search.get('blurCDN') || undefined;
const BACKGROUND_BLUR_ASSET_GROUP = search.get('blurAssetGroup') || undefined;
const BACKGROUND_BLUR_REVISION_ID = search.get('blurRevisionID') || undefined;

const BACKGROUND_BLUR_PATHS: BackgroundFilterPaths = BACKGROUND_BLUR_CDN && {
  worker: `${BACKGROUND_BLUR_CDN}/bgblur/workers/worker.js`,
  wasm: `${BACKGROUND_BLUR_CDN}/bgblur/wasm/_cwt-wasm.wasm`,
  simd: `${BACKGROUND_BLUR_CDN}/bgblur/wasm/_cwt-wasm-simd.wasm`,
};
const BACKGROUND_BLUR_MODEL = BACKGROUND_BLUR_CDN && ModelSpecBuilder.builder()
  .withSelfieSegmentationDefaults()
  .withPath(`${BACKGROUND_BLUR_CDN}/bgblur/models/selfie_segmentation_landscape.tflite`)
  .build();
const BACKGROUND_BLUR_ASSET_SPEC = (BACKGROUND_BLUR_ASSET_GROUP || BACKGROUND_BLUR_REVISION_ID) && {
  assetGroup: BACKGROUND_BLUR_ASSET_GROUP,
  revisionID: BACKGROUND_BLUR_REVISION_ID,
}

type VideoFilterName = 'Emojify' | 'CircularCut' | 'NoOp' | 'Segmentation' | 'Resize (9/16)' | 'Background Blur 10% CPU' | 'Background Blur 20% CPU' | 'Background Blur 30% CPU' | 'Background Blur 40% CPU' | 'Background Replacement' | 'None';

const VIDEO_FILTERS: VideoFilterName[] = ['Emojify', 'CircularCut', 'NoOp', 'Resize (9/16)'];
 */

type ButtonState = 'on' | 'off' | 'disabled';

export enum ContentShareType {
  ScreenCapture,
  VideoFile,
}

// Esto de simulcast layer es para la resolucion de los video streams, pero no se si video de una
// persona o video compartido por pantalla
const SimulcastLayerMapping = {
    [SimulcastLayers.Low]: 'Low',
    [SimulcastLayers.LowAndMedium]: 'Low and Medium',
    [SimulcastLayers.LowAndHigh]: 'Low and High',
    [SimulcastLayers.Medium]: 'Medium',
    [SimulcastLayers.MediumAndHigh]: 'Medium and High',
    [SimulcastLayers.High]: 'High',
  };

interface Toggle {
    name: string;
    oncreate: (elem: HTMLElement) => void;
    action: () => void;
}
  
interface TranscriptSegment {
    contentSpan: HTMLSpanElement,
    attendee: Attendee;
    startTimeMs: number;
    endTimeMs: number;
}
  
interface TranscriptionStreamParams {
    contentIdentificationType?: 'PII' | 'PHI';
    contentRedactionType?: 'PII';
    enablePartialResultsStability?: boolean;
    partialResultsStability?: string;
    piiEntityTypes?: string;
    languageModelName?: string;
    identifyLanguage?: boolean;
    languageOptions?: string;
    preferredLanguage?: string;
}