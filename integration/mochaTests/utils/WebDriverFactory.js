const { Builder } = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');
const { Logger, LogLevel } = require('../utils/Logger');
const config = require('../configs/BaseConfig');

class WebDriverFactory {
  constructor(testName, host, testType, url, logger) {
    this.testName = testName;
    this.host = host;
    this.testType = testType;
    this.url = url;
    if (!!logger) {
      this.logger = logger;
    } else {
      this.logger = new Logger('WebDriverFactory');
    }
    this.numberOfSessions = 1;
  }

  configure() {
    let builder = new Builder();
    let client;
    switch (this.host) {
      case 'local':
        break;

      case 'saucelabs':
        builder.usingServer(this.url);
        builder.withCapabilities({
          ...config.sauceOptions,
        });
        break;

      default:
        this.logger.log('Invalid host, using local host instead', LogLevel.WARN);
        break;
    }

    switch (this.testType) {
      case 'integration-test':
        this.logger.log('Using integration test default settings');
        builder.forBrowser('chrome');
        builder.withCapabilities({
          ...config.chromeOptions,
        });
        break;

      case `browser-compatibility`:
        this.logger.log('Using the provided browser compatibility config');
        client = JSON.parse(process.env.CLIENT);

        if (client.browserName === 'chrome') {
          builder.withCapabilities({
            ...config.chromeOptions,
          });
        } else if (client.browserName === 'firefox') {
          builder.withCapabilities({
            ...config.firefoxOptions,
          });
        } else if (client.browserName === 'safari') {
          this.numberOfSessions = 2;
          builder.withCapabilities({
            ...config.safariOptions,
          });
        } else {
          this.logger.log(
            `browserName: ${client.browserName} defined in the test config is not valid`,
            LogLevel.ERROR
          );
          throw new Error(`browserName defined in the test config is not valid`);
        }

        if (client.platform === 'android') {
          this.numberOfSessions = 2;
        }
        process.env.PLATFORM_NAME = client.platform;
        process.env.BROWSER_VERSION = client.browserVersion;
        builder.withCapabilities({
          ...config.sauceOptions,
        });

        break;

      default:
        this.logger.log('Using default settings');
        this.logger.log('Running chrome latest on MAC');
        builder.forBrowser('chrome');
        builder.withCapabilities({
          ...config.chromeOptions,
        });
        break;
    }

    return builder;
  }

  async build() {
    const service = new chrome.ServiceBuilder('/Users/kunalnan/Downloads/chromedriver');
    this.driver = await this.configure().setChromeService(service).build();
    const { id_ } = await this.driver.getSession();
    this.sessionId = id_;
    this.driver.executeScript('sauce:job-name=' + this.testName);
  }

  async quit(testResult) {
    if (this.host.startsWith('sauce')) {
      this.driver.executeScript('sauce:job-result=' + testResult);
      this.logger.log(
        `See a video of the run at https://saucelabs.com/tests/, session id = ${this.sessionId}`
      );
    }
    await this.driver.quit();
  }
}

module.exports = WebDriverFactory;
