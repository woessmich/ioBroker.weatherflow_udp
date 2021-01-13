/*
 * Created with @iobroker/create-adapter v1.25.0
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const utils = require('@iobroker/adapter-core');

// Load your modules here, e.g.:
const dgram = require('dgram');

// If radiation is more than 120 W/m2 it is counted as sunshine (https://de.wikipedia.org/wiki/Sonnenschein)
const SUNSHINETHRESHOLD = 120;

//  const as min max function parameter
const MIN = 1;
const MAX = 2;

let mServer = null;
let timer;

let now = new Date(); // set as system time for now, will be overwritten if timestamp is recieved
let oldNow = new Date(); // set as system time for now, will be overwritten if timestamp is recieved

const existingStates = [];

// Import constants with static interpretation data
const {
  devices, messages, windDirections, minCalcs, maxCalcs, sensorfails, powermodes,
} = require(`${__dirname}/lib/messages`);

class WeatherflowUdp extends utils.Adapter {
  /**
     * @param {Partial<utils.AdapterOptions>} [options={}]
     */
  constructor(options) {
    super({
      ...options,
      name: 'weatherflow_udp',
    });
    this.on('ready', this.onReady.bind(this));
    this.on('unload', this.onUnload.bind(this));
  }

  /**
     * Is called when databases are connected and adapter received configuration.
     */
  onReady() {
    // Initialize your adapter here
    this.main();
  }

  async main() {
    const that = this;

    mServer = dgram.createSocket('udp4');

    // Attach to UDP Port
    try {
      mServer.bind(this.config.UDP_port, '0.0.0.0');
    } catch (e) {
      that.log.error(['Could not bind to port: ', this.config.UDP_port, '. Adapter stopped.'].join(''));
    }

    mServer.on('error', (err) => {
      this.log.error(`Cannot open socket:\n${err.stack}`);
      mServer.close();
      timer = setTimeout(() => process.exit(), 1000); // delay needed to wait for logging
    });

    // Reset the connection indicator during startup
    this.setState('info.connection', false, true);

    mServer.on('listening', () => {
      const address = mServer.address();
      that.log.info(`adapter listening ${address.address}:${address.port}`);
    });

    // Receive UDP message
    mServer.on('message', (messageString, rinfo) => {
      let message; // JSON parsed message

      if (that.config.debug === true) { that.log.debug(`${rinfo.address}:${rinfo.port} - ${messageString.toString('ascii')}`); }

      try {
        message = JSON.parse(messageString.toString());
      } catch (e) {
        // Anweisungen für jeden Fehler
        that.log.warn(['Non-JSON message received: "', message, '". Ignoring.'].join(''));
        return;
      }

      // stop processing if message does not have a type
      if ('type' in message === false) {
        that.log.warn(['Non- or unknown weatherflow message received: "', message, '". Ignoring.'].join(''));
        return;
      }

      // Set connection state when message received and expire after 6 minutes of inactivity
      that.setStateAsync('info.connection', { val: true, ack: true, expire: 360 });

      const messageType = message.type; // e.g. 'rapid_wind'

      if (that.config.debug === true) { that.log.info(['Message type: "', message.type, '"'].join('')); }

      const messageInfo = messages[messageType];

      if (that.config.debug === true) { that.log.info(['messageInfo: ', JSON.stringify(messageInfo)].join('')); }

      let statePath; // name of current state to set or create

      if (!messageInfo) {
        if (that.config.debug === true) { that.log.info(['Unknown message type: ', messageType, ' - ignoring'].join('')); }
      } else {
        if (that.config.debug === true) { that.log.info(['messageInfo: ', JSON.stringify(messageInfo)].join('')); }

        if ('serial_number' in message) { // create structure for device
          // Get type from first 2 characters of serial number
          const deviceType = devices[message.serial_number.substring(0, 2)];

          const serialParameters = {
            type: 'device',
            common: {
              name: `${deviceType}: ${message.serial_number}`,
            },
            native: {},
          };

          if ('hub_sn' in message) { // device message with serial and hub serial
            // Create state for hub

            // Type is first 2 chars of serial number
            const hubType = devices[message.hub_sn.substring(0, 2)];

            const hubSnParameters = {
              type: 'device',
              common: {
                name: `${hubType}:${message.hub_sn}`,
              },
              native: {},
            };

            that.myCreateState(message.hub_sn, hubSnParameters); // create device
            that.myCreateState([message.hub_sn, message.serial_number].join('.'), serialParameters); // create device

            // Set complete path to state hub and serial
            statePath = [message.hub_sn, message.serial_number, message.type].join('.');
          } else { // device message without hub serial (probably only hub)
            that.myCreateState(message.serial_number, serialParameters); // create device

            // Set path to state
            statePath = [message.serial_number, '.', message.type].join('');
          }
        }

        if (that.config.debug) { that.log.info(['statepath: ', statePath].join('')); }

        // Write last message to the node lastMessage in statepath
        const lastMessageParameter = {
          type: 'state',
          common: {
            name: 'Last message on this channel',
            type: 'string',
            role: 'text',
            read: true,
            write: false,
          },
          native: {},
        };

        that.myCreateState([statePath, 'lastMessage'].join('.'), lastMessageParameter, messageString.toString('ascii')); // create/update lestMessage state per message type

        // Walk through items of message
        Object.keys(message).forEach((item) => {
          let itemvalue = [];

          if (typeof message[item][0] === 'object') { // some items like 'obs' are double arrays [[]], remove outer array
            itemvalue = message[item][0];
          } else if (typeof message[item] === 'object') { // some are arrays, take as is
            itemvalue = message[item];
          } else if (typeof message[item] === 'number' || typeof message[item] === 'string') { // others are just numbers or strings, then wrap into an array
            itemvalue.push(message[item]);
          }

          if (that.config.debug) { that.log.info(['item: ', item, ' = ', itemvalue].join('')); }

          // Set some Items to be ignored later as they are parsed differently
          const ignoreItems = ['type', 'serial_number', 'hub_sn'];

          // Check for unknown/new items
          if ((item in messageInfo) === false && ignoreItems.includes(item) === false) {
            that.log.warn(['Message ', messageType, ' contains unknown parameter: ', item, ' = ', itemvalue, '. Ignoring. Please check UDP message version and check with adapter developer.'].join(''));
          }

          // only parse if part of 'states' definition
          if (messageInfo[item] !== null && ignoreItems.includes(item) === false) {
            // Walk through fields 0 ... n
            Object.keys(itemvalue).forEach(async (field) => {
              if (!messageInfo[item][field]) {
                that.log.warn(['Message contains unknown field "(', field, '" in message ', item, ')". Check UDP message version and inform adapter developer.'].join(''));
                return;
              }

              const pathParameters = {
                type: 'channel',
                common: {
                  name: messageInfo.name,
                },
                native: {},
              };
              const stateParameters = messageInfo[item][field][1];
              const stateName = [statePath, messageInfo[item][field][0]].join('.');
              let fieldvalue = itemvalue[field];

              // Deal with timestamp messages
              if (messageInfo[item][field][0] === 'timestamp') {
                fieldvalue = new Date(fieldvalue * 1000); // timestamp in iobroker is milliseconds and provided timestamp is seconds
              }

              if (that.config.debug === true) { that.log.info(['[', field, '] ', 'state: ', stateName, ' = ', fieldvalue].join('')); }

              // handle timestamp old and new as now and oldNow
              // used later
              if (messageInfo[item][field][0] === 'timestamp') {
                now = new Date(fieldvalue); // now is date/time of current message

                const obj = await that.getValObj(stateName);
                if (obj !== null) {
                  oldNow = new Date(obj.val);
                }
              }

              // Special corrections on data
              //= =====================================

              if (messageInfo[item][field][0] === 'lightningStrikeAvgDistance' && fieldvalue === 0) {
                // If average lightning distance is zero, no lightning was detected, set to 999 to mark this fact
                fieldvalue = 999;
              }

              // Walkaround for for occasional 0-pressure values
              if (messageInfo[item][field][0] === 'stationPressure' && fieldvalue === 0) {
                return; // skip value if this happens
              }

              // Calculate minimum values of today and yesterday for native values

              // Min-values
              if (minCalcs.includes(messageInfo[item][field][0])) {
                that.calcMinMaxValue(stateName, stateParameters, fieldvalue, MIN);
              }

              // Max-values
              if (maxCalcs.includes(messageInfo[item][field][0])) {
                that.calcMinMaxValue(stateName, stateParameters, fieldvalue, MAX);
              }

              // And update states
              //= ============
              that.myCreateState(statePath, pathParameters); // create channel
              that.myCreateState(stateName, stateParameters, fieldvalue); // create node

              //= =====================================
              // Do special tasks based on message type
              //= =====================================

              // set a state for rain intensity
              // ------------------------------

              // NONE: 0 mm / hour
              // VERY LIGHT: > 0, < 0.25 mm / hour
              // LIGHT: ≥ 0.25, < 1.0 mm / hour
              // MODERATE: ≥ 1.0, < 4.0 mm / hour
              // HEAVY: ≥ 4.0, < 16.0 mm / hour
              // VERY HEAVY: ≥ 16.0, < 50 mm / hour
              // EXTREME: > 50.0 mm / hour

              if (messageInfo[item][field][0] === 'precipAccumulated') {
                const stateNameRainIntensity = [statePath, 'rainIntensity'].join('.');
                const stateParametersRainIntensity = {
                  type: 'state',
                  common: {
                    type: 'mixed',
                    states: {
                      0: 'none', 1: 'very light', 2: 'light', 3: 'moderate', 4: 'heavy', 5: 'very heavy', 6: 'extreme',
                    },
                    read: true,
                    write: false,
                    role: 'value.precipitation.level',
                    name: 'Rain intensity; adapter calculated',
                  },
                  native: {},
                };
                const reportIntervalName = [statePath, 'reportInterval'].join('.');
                let rainIntensity = 0;
                const reportInterval = await that.getValObj(reportIntervalName);

                if (reportInterval !== null) {
                  if ((fieldvalue * 60) / reportInterval.val > 50) {
                    rainIntensity = 6;
                  } else if ((fieldvalue * 60) / reportInterval.val > 16) {
                    rainIntensity = 5;
                  } else if ((fieldvalue * 60) / reportInterval.val > 4) {
                    rainIntensity = 4;
                  } else if ((fieldvalue * 60) / reportInterval.val > 1) {
                    rainIntensity = 3;
                  } else if ((fieldvalue * 60) / reportInterval.val > 0.25) {
                    rainIntensity = 2;
                  } else if ((fieldvalue * 60) / reportInterval.val > 0) {
                    rainIntensity = 1;
                  }

                  that.myCreateState(stateNameRainIntensity, stateParametersRainIntensity, rainIntensity);
                }
              }

              // raining or not as binary state?
              //-------------------------------
              if (messageInfo[item][field][0] === 'precipAccumulated') {
                const statePathCorrected = statePath.replace('obs_st', 'evt_precip').replace('obs_sky', 'evt_precip'); // move state from observation to evt_precip
                const stateNameRaining = [statePathCorrected, 'raining'].join('.');
                const stateParametersRaining = {
                  type: 'state',
                  common: {
                    type: 'boolean', read: true, write: false, role: 'indicator.rain', name: 'Raining; adapter calculated', def: 0,
                  },
                  native: {},
                };
                if (fieldvalue > 0) {
                  that.myCreateState(stateNameRaining, stateParametersRaining, true);
                } else {
                  that.myCreateState(stateNameRaining, stateParametersRaining, false);
                }
              }

              if (messageType === 'evt_precip' && messageInfo[item][field][0] === 'timestamp') { // if precipitation start is recieved also set to true
                const stateNameRaining = [statePath, 'raining'].join('.');
                const stateParametersRaining = {
                  type: 'state',
                  common: {
                    type: 'boolean', read: true, write: false, role: 'indicator.rain', name: 'Raining; adapter calculated', def: 0,
                  },
                  native: {},
                };
                that.myCreateState(stateNameRaining, stateParametersRaining, true);
              }

              // rain accumulation and time of current and previous hour
              //-------------------------------------------------------
              if (messageInfo[item][field][0] === 'precipAccumulated') {
                // rain amount
                // -----------
                const stateNameCurrentHourA = [statePath, 'precipAccumulatedCurrentHour'].join('.');
                const stateParametersCurrentHourA = {
                  type: 'state',
                  common: {
                    type: 'number', unit: 'mm', read: true, write: false, role: 'value.precipitation', name: 'Accumulated rain in current hour; adapter calculated',
                  },
                  native: {},
                };

                const stateNamePreviousHourA = [statePath, 'precipAccumulatedPreviousHour'].join('.');
                const stateParametersPreviousHourA = {
                  type: 'state',
                  common: {
                    type: 'number', unit: 'mm', read: true, write: false, role: 'value.precipitation', name: 'Accumulated rain in previous hour; adapter calculated',
                  },
                  native: {},
                };

                const stateNameTodayA = [statePath, 'precipAccumulatedToday'].join('.');
                const stateParametersTodayA = {
                  type: 'state',
                  common: {
                    type: 'number', unit: 'mm', read: true, write: false, role: 'value.precipitation', name: 'Accumulated rain today; adapter calculated',
                  },
                  native: {},
                };

                const stateNameYesterdayA = [statePath, 'precipAccumulatedYesterday'].join('.');
                const stateParametersYesterdayA = {
                  type: 'state',
                  common: {
                    type: 'number', unit: 'mm', read: true, write: false, role: 'value.precipitation', name: 'Accumulated rain yesterday; adapter calculated',
                  },
                  native: {},
                };

                let newValueHourA = 0;
                let newValueDayA = 0;

                // hour
                const objhourA = await this.getValObj(stateNameCurrentHourA); // get old value
                if (objhourA !== null) {
                  if (now.getHours() === oldNow.getHours()) { // same hour
                    newValueHourA = objhourA.val + fieldvalue; // add
                  } else { // different hour
                    newValueHourA = fieldvalue; // replace
                    that.myCreateState(stateNamePreviousHourA, stateParametersPreviousHourA, objhourA.val); // save value from current hour to last hour
                  }
                }
                that.myCreateState(stateNameCurrentHourA, stateParametersCurrentHourA, newValueHourA); // always write value for current hour

                // day
                const objdayA = await this.getValObj(stateNameTodayA); // get old value
                if (objdayA !== null) {
                  if (now.getDay() === oldNow.getDay()) { // same hour
                    newValueDayA = objdayA.val + fieldvalue; // add
                  } else { // different hour
                    newValueDayA = fieldvalue; // replace
                    that.myCreateState(stateNameYesterdayA, stateParametersYesterdayA, objdayA.val); // save value from current day to yesterday
                  }
                }

                that.myCreateState(stateNameTodayA, stateParametersTodayA, newValueDayA); // always write value for current day

                // rain duration
                // -------------

                const stateNameCurrentHourD = [statePath, 'precipDurationCurrentHour'].join('.');
                const stateParametersCurrentHourD = {
                  type: 'state',
                  common: {
                    type: 'number', unit: 'min', read: true, write: false, role: 'value.precipitation.duration', name: 'Rain duration in current hour; adapter calculated',
                  },
                  native: {},
                };

                const stateNamePreviousHourD = [statePath, 'precipDurationPreviousHour'].join('.');
                const stateParametersPreviousHourD = {
                  type: 'state',
                  common: {
                    type: 'number', unit: 'min', read: true, write: false, role: 'value.precipitation.duration', name: 'Rain duration in previous hour; adapter calculated',
                  },
                  native: {},
                };

                const stateNameTodayD = [statePath, 'precipDurationToday'].join('.');
                const stateParametersTodayD = {
                  type: 'state',
                  common: {
                    type: 'number', unit: 'h', read: true, write: false, role: 'value.precipitation.duration', name: 'Rain duration today; adapter calculated',
                  },
                  native: {},
                };

                const stateNameYesterdayD = [statePath, 'precipDurationYesterday'].join('.');
                const stateParametersYesterdayD = {
                  type: 'state',
                  common: {
                    type: 'number', unit: 'h', read: true, write: false, role: 'value.precipitation.duration', name: 'Rain duration yesterday; adapter calculated',
                  },
                  native: {},
                };

                const reportIntervalNameD = [statePath, 'reportInterval'].join('.');

                let newValueHourD = 0;
                let newValueDayD = 0;

                // hour
                const objhourD = await this.getValObj(stateNameCurrentHourD); // get old value
                const reportIntervalD = await this.getValObj(reportIntervalNameD); // get report Interval for multiplication

                if (objhourD !== null && reportIntervalD !== null) {
                  if (now.getHours() === oldNow.getHours()) { // same hour
                    if (fieldvalue > 0) {
                      newValueHourD = objhourD.val + reportIntervalD.val; // add
                    } else {
                      newValueHourD = objhourD.val; // no change
                    }
                  } else { // different hour
                    if (fieldvalue > 0) {
                      newValueHourD = reportIntervalD.val; // replace
                    } else {
                      newValueHourD = 0; // reset todays value
                    }
                    that.myCreateState(stateNamePreviousHourD, stateParametersPreviousHourD, objhourD.val); // save value from current hour to last hour
                  }
                }

                that.myCreateState(stateNameCurrentHourD, stateParametersCurrentHourD, newValueHourD); // always write value for current hour

                const objdayD = await this.getValObj(stateNameTodayD); // get old value

                if (objdayD !== null && reportIntervalD !== null) {
                  if (now.getDay() === oldNow.getDay()) { // same day
                    if (fieldvalue > 0) {
                      newValueDayD = objdayD.val + reportIntervalD.val / 60; // add in hours
                    } else {
                      newValueDayD = objdayD.val;
                    }
                  } else { // different day
                    if (fieldvalue > 0) {
                      newValueDayD = reportIntervalD.val / 60; // replace
                    } else {
                      newValueDayD = 0;
                    }
                    that.myCreateState(stateNameYesterdayD, stateParametersYesterdayD, objdayD.val); // save value from current day to last yesterday
                  }
                }

                that.myCreateState(stateNameTodayD, stateParametersTodayD, newValueDayD); // always write value for current day
              }

              // sunshine duration of previous and current hour, today and last day
              //------------------------------------------------------------------
              if (messageInfo[item][field][0] === 'solarRadiation') {
                // sunshine duration

                const stateNameCurrentHour = [statePath, 'sunshineDurationCurrentHour'].join('.');
                const stateParametersCurrentHour = {
                  type: 'state',
                  common: {
                    type: 'number', unit: 'min', read: true, write: false, role: 'value.sunshine', name: 'Sunshine duration in current hour; adapter calculated',
                  },
                  native: {},
                };

                const stateNamePreviousHour = [statePath, 'sunshineDurationPreviousHour'].join('.');
                const stateParametersPreviousHour = {
                  type: 'state',
                  common: {
                    type: 'number', unit: 'min', read: true, write: false, role: 'value.sunshine', name: 'Sunshine duration in previous hour; adapter calculated',
                  },
                  native: {},
                };

                const stateNameToday = [statePath, 'sunshineDurationToday'].join('.');
                const stateParametersToday = {
                  type: 'state',
                  common: {
                    type: 'number', unit: 'h', read: true, write: false, role: 'value.sunshine', name: 'Sunshine duration today; adapter calculated',
                  },
                  native: {},
                };

                const stateNameYesterday = [statePath, 'sunshineDurationYesterday'].join('.');
                const stateParametersYesterday = {
                  type: 'state',
                  common: {
                    type: 'number', unit: 'h', read: true, write: false, role: 'value.sunshine', name: 'Sunshine duration yesterday; adapter calculated',
                  },
                  native: {},
                };

                const reportIntervalName = [statePath, 'reportInterval'].join('.');

                // hour
                let newValueHour = 0;
                let newValueDay = 0;

                const objhour = await that.getValObj(stateNameCurrentHour); // get old value
                const reportInterval = await that.getValObj(reportIntervalName);

                if (objhour !== null && reportInterval !== null) {
                  if (now.getHours() === oldNow.getHours()) { // same hour
                    if (fieldvalue >= SUNSHINETHRESHOLD) {
                      newValueHour = objhour.val + reportInterval.val; // add
                    }
                  } else { // different hour
                    if (fieldvalue >= SUNSHINETHRESHOLD) {
                      newValueHour = reportInterval.val; // replace
                    } else {
                      newValueHour = 0;
                    }
                    that.myCreateState(stateNamePreviousHour, stateParametersPreviousHour, objhour.val); // save value from current hour to last hour
                  }
                }

                that.myCreateState(stateNameCurrentHour, stateParametersCurrentHour, newValueHour); // always write value for current hour

                // day
                const objday = await that.getValObj(stateNameToday); // get old value

                if (objday !== null && reportInterval !== null) {
                  if (now.getDay() === oldNow.getDay()) { // same day
                    if (fieldvalue >= SUNSHINETHRESHOLD) {
                      newValueDay = objday.val + reportInterval.val / 60; // add
                    } else {
                      newValueDay = objday.val;
                    }
                  } else { // different hour
                    if (fieldvalue >= SUNSHINETHRESHOLD) {
                      newValueDay = reportInterval.val / 60; // replace
                    } else {
                      newValueDay = 0;
                    }
                    that.myCreateState(stateNameYesterday, stateParametersYesterday, objday.val); // save value from current day to last yesterday
                  }
                }

                that.myCreateState(stateNameToday, stateParametersToday, newValueDay); // always write value for current day
              }

              // Set a state sunshine to true, if above threshold
              //------------------------------------------------
              if (messageInfo[item][field][0] === 'solarRadiation') {
                const stateNameSunshine = [statePath, 'sunshine'].join('.');
                const stateParametersSunshine = {
                  type: 'state',
                  common: {
                    type: 'boolean', read: true, write: false, role: 'indicator.sunshine', name: 'Sunshine (> 120 W/m2); adapter calculated',
                  },
                  native: {},
                };
                if (fieldvalue >= SUNSHINETHRESHOLD) {
                  that.myCreateState(stateNameSunshine, stateParametersSunshine, true);
                } else {
                  that.myCreateState(stateNameSunshine, stateParametersSunshine, false);
                }
              }

              // Reduced pressure (sea level) from station pressure
              //--------------------------------------------------
              if (messageInfo[item][field][0] === 'stationPressure') {
                let airTemperature = 15; // standard value if not available
                let relativeHumidity = 50; // standard value if not available

                const stateNameAirTemperature = [statePath, 'airTemperature'].join('.');
                const stateNameRelativeHumidity = [statePath, 'relativeHumidity'].join('.');
                const stateNameReducedPressure = [statePath, 'reducedPressure'].join('.');
                const stateParametersReducedPressure = {
                  type: 'state',
                  common: {
                    type: 'number', unit: 'hPa', read: true, write: false, role: 'value.pressure', name: 'Reduced pressure (sea level); adapter calculated',
                  },
                  native: {},
                };

                const obj = await that.getValObj(stateNameAirTemperature);
                const obj1 = await that.getValObj(stateNameRelativeHumidity);

                if (obj !== null && obj1 !== null) {
                  airTemperature = obj.val;
                  relativeHumidity = obj1.val;

                  const reducedPressure = getQFF(airTemperature, fieldvalue, that.config.height, relativeHumidity);

                  // Calculate min/max for reduced pressure
                  that.calcMinMaxValue(stateNameReducedPressure, stateParametersReducedPressure, reducedPressure, MIN);
                  that.calcMinMaxValue(stateNameReducedPressure, stateParametersReducedPressure, reducedPressure, MAX);

                  that.myCreateState(stateNameReducedPressure, stateParametersReducedPressure, reducedPressure);

                  if (that.config.debug) { that.log.info(['Pressure conversion: ', 'Station pressure: ', fieldvalue, ', Height: ', that.config.height, ', Temperature: ', airTemperature, ', Humidity: ', relativeHumidity, ', Reduced pressure: ', reducedPressure].join('')); }
                }
              }

              // Dewpoint from temperature and humidity
              //----------------------------------------------
              // Is calculated and written when humidity is received (temperature comes before that, so it should be current)
              if (messageInfo[item][field][0] === 'relativeHumidity') {
                const stateNameAirTemperature = [statePath, 'airTemperature'].join('.');
                const stateNameDewpoint = [statePath, 'dewpoint'].join('.');
                const stateParametersDewpoint = {
                  type: 'state',
                  common: {
                    type: 'number', unit: '°C', read: true, write: false, role: 'value.temperature.dewpoint', name: 'Dewpoint; adapter calculated',
                  },
                  native: {},
                };

                const obj = await that.getValObj(stateNameAirTemperature);
                if (obj !== null) {
                  const airTemperature = obj.val;

                  // Calculate min/max for dewpoint
                  that.calcMinMaxValue(stateNameDewpoint, stateParametersDewpoint, dewpoint(airTemperature, fieldvalue), MIN);
                  that.calcMinMaxValue(stateNameDewpoint, stateParametersDewpoint, dewpoint(airTemperature, fieldvalue), MAX);

                  that.myCreateState(stateNameDewpoint, stateParametersDewpoint, dewpoint(airTemperature, fieldvalue));
                }
              }

              // Feels like from temperature and humidity and wind
              //-------------------------------------------------
              // Is calculated and written when humidity is received (wind and temperature comes before that, so they should be current)
              if (messageInfo[item][field][0] === 'relativeHumidity') {
                const stateNameAirTemperature = [statePath, 'airTemperature'].join('.');
                const stateNameFeelsLike = [statePath, 'feelsLike'].join('.');
                const stateNameWindAvg = [statePath, 'windAvg'].join('.');
                const stateParametersFeelsLike = {
                  type: 'state',
                  common: {
                    type: 'number', unit: '°C', read: true, write: false, role: 'value.temperature.feelslike', name: 'Feels like temperature (Heat index/wind chill), °C; adapter calculated',
                  },
                  native: {},
                };

                const obj1 = await that.getValObj(stateNameAirTemperature);
                const obj2 = await that.getValObj(stateNameWindAvg);
                if (obj1 !== null && obj2 !== null) {
                  const airTemperature = obj1.val;
                  const windAvg = obj2.val;

                  // Calculate min/max for feelsLike
                  that.calcMinMaxValue(stateNameFeelsLike, stateParametersFeelsLike, feelsLike(airTemperature, windAvg, fieldvalue), MIN);
                  that.calcMinMaxValue(stateNameFeelsLike, stateParametersFeelsLike, feelsLike(airTemperature, windAvg, fieldvalue), MAX);

                  that.myCreateState(stateNameFeelsLike, stateParametersFeelsLike, feelsLike(airTemperature, windAvg, fieldvalue));
                }
              }

              // Convert wind directions from degrees to cardinal directions
              // -----------------------------------------------------------
              if (messageInfo[item][field][0] === 'windDirection') {
                const stateNameWindDirectionText = [statePath, 'windDirectionCardinal'].join('.');
                const stateParametersWindDirectionText = {
                  type: 'state',
                  common: {
                    type: 'string', unit: '', read: true, write: false, role: 'text.direction.wind', name: 'Cardinal wind direction; adapter calculated',
                  },
                  native: {},
                };

                that.myCreateState(stateNameWindDirectionText, stateParametersWindDirectionText, windDirections[Math.round(fieldvalue / 22.5)]);
              }

              // Convert wind speed from m/s to Beaufort
              // ---------------------------------------
              if (['windSpeed', 'windGust', 'windLull', 'windAvg'].includes(messageInfo[item][field][0])) {
                let stateNameBeaufort;
                switch (messageInfo[item][field][0]) {
                  case 'windGust':
                    stateNameBeaufort = [statePath, 'beaufortGust'].join('.');
                    break;

                  case 'windLull':
                    stateNameBeaufort = [statePath, 'beaufortLull'].join('.');
                    break;

                  case 'windAvg':
                    stateNameBeaufort = [statePath, 'beaufortAvg'].join('.');
                    break;

                  default:
                    stateNameBeaufort = [statePath, 'beaufort'].join('.');
                }

                const stateParametersBeaufort = {
                  type: 'state',
                  common: {
                    type: 'number', unit: '', read: true, write: false, role: 'value.speed.wind', name: 'Wind speed in Beaufort; adapter calculated',
                  },
                  native: {},
                };

                // Calculate max for beaufort windspeeds
                that.calcMinMaxValue(stateNameBeaufort, stateParametersBeaufort, beaufort(fieldvalue), MAX);

                // Write new value to state (or create first, if needed)
                that.myCreateState(stateNameBeaufort, stateParametersBeaufort, beaufort(fieldvalue));
              }

              // Sensor status as text from binary
              //---------------------------------
              if (messageInfo[item][field][0] === 'sensor_status') {
                let sensorStatusText = '';
                const stateNameSensorStatusText = [statePath, 'sensor_statusText'].join('.');
                const stateParametersSensorStatusText = {
                  type: 'state',
                  common: {
                    type: 'string', unit: '', read: true, write: false, role: 'text.status', name: 'Sensor status; adapted calculated',
                  },
                  native: {},
                };
                Object.keys(sensorfails).forEach((item) => {
                  if ((fieldvalue & parseInt(item)) === parseInt(item)) {
                    if (sensorStatusText !== '') {
                      sensorStatusText += ', ';
                    }
                    sensorStatusText += sensorfails[item];
                  }
                  if (sensorStatusText === '') {
                    sensorStatusText = 'Sensors OK';
                  }
                });
                that.myCreateState(stateNameSensorStatusText, stateParametersSensorStatusText, sensorStatusText);
              }

              // Powermodes from sensor_status
              //---------------------------------
              if (messageInfo[item][field][0] === 'sensor_status') {
                const stateNamePowerMode = [statePath, 'powerMode'].join('.');
                const stateParametersPowerMode = {
                  type: 'state',
                  common: {
                    type: 'mixed',
                    states: {
                      0: 'Mode 0: Full power all sensors enabled', 1: 'Mode 1: Rapid sample interval set to six seconds', 2: 'Mode 2: Rapid sample interval set to one minute', 3: 'Mode 3: Rapid sample interval set to five minutes; Sensor sample interval set to five minutes; Lightning sensor disabled; Haptic sensor disabled',
                    },
                    read: true,
                    write: false,
                    role: 'text.status',
                    name: 'Power mode; adapter calculated',
                  },
                  native: {},
                };

                let Mode = 0;
                Object.keys(powermodes).forEach((powermode) => {
                  // eslint-disable-next-line no-bitwise
                  if ((fieldvalue & parseInt(powermode)) === parseInt(powermode)) {
                    Mode = powermodes[powermode];
                  }
                });
                that.myCreateState(stateNamePowerMode, stateParametersPowerMode, Mode);
              }

              //= =============================
              // End of special tasks section
            });
          }
        });
      }
    });
  }

  /**
     * Is called when adapter shuts down - callback has to be called under any circumstances!
     * @param {() => void} callback
     */
  onUnload(callback) {
    try {
      clearTimeout(timer); // stop timeout from loggin at stop
      mServer.close(); // close UDP port
      this.log.info('cleaned everything up...');
      callback();
    } catch (e) {
      callback();
    }
  }

  /**
    * Write value to state or create if not already existing
    * @param {string} stateName The full path and name of the state to be created
    * @param {object} stateParameters Set of parameters for creation of state
    * @param {number | string | null | boolean} stateValue Value of the state (optional)
    * @param {number} expiry Time in seconds until the value is set back to false (optional)
    */
  async myCreateState(stateName, stateParameters, stateValue = null, expiry = 0) {
    const that = this;
    if (!existingStates.includes(stateName)) { // state not existing?
      existingStates.push(stateName); // Remember state is existing or was created
      const obj = await this.setObjectNotExistsAsync(stateName, stateParameters); // create if not existing and log creation
      if (obj) {
        that.log.info(`Creating node: ${stateName}`);
      }
    }
    if (stateValue !== null) { // Write value if provided
      await this.setStateAsync(stateName, { val: stateValue, ack: true, expire: expiry });
    }
  }

  /**
   * Return obj from state if key "val" exists, otherwise return null
   * @param {string} stateName THe full path and name of the state to be read
   */
  async getValObj(stateName) {
    const obj = await this.getStateAsync(stateName);
    if (obj) {
      if ('val' in obj) {
        return obj;
      }
    }
    return null;
  }

  /**
    * Calculate min/max for today and yesterday
    * @param {string} stateName The full path and name of the state to be created
    * @param {object} stateParameters Set of parameters for creation of state
    * @param {number | string | null | boolean} stateValue Value of the state (optional)
    * @param {number} calcType 1='min' or 2='max' to calculate minimum or maximum value
    */
  async calcMinMaxValue(stateName, stateParameters, stateValue, calcType) {
    const stateparts = stateName.split('.'); // split statename to insert min/max today/yesterday as levels
    const state = stateparts.pop(); // extract last as state
    const stateBase = [...stateparts].join('.'); // and put rest back together

    const minmaxStateParametersToday = JSON.parse(JSON.stringify(stateParameters)); // Make a real copy not just an addtl. reference
    const minmaxStateParametersYesterday = JSON.parse(JSON.stringify(stateParameters)); // Take parameters from main value ...

    let minmaxStateNameToday = '';
    let minmaxStateNameYesterday = '';

    switch (calcType) {
      case MIN:
        minmaxStateNameToday = `${stateBase}.today.min.${state}`; // create state name
        minmaxStateParametersToday.common.name += ' / today / min; adapter calculated'; // ... and add something to the name
        minmaxStateNameYesterday = `${stateBase}.yesterday.min.${state}`; // create state name
        minmaxStateParametersYesterday.common.name += ' / min / yesterday; adapter calculated'; // ... and add something to the name
        break;

      case MAX:
        minmaxStateNameToday = `${stateBase}.today.max.${state}`; // create state name
        minmaxStateParametersToday.common.name += ' / today / max; adapter calculated'; // ... and add something to the name
        minmaxStateNameYesterday = `${stateBase}.yesterday.max.${state}`; // create state name
        minmaxStateParametersYesterday.common.name += ' / yesterday / max; adapter calculated'; // ... and add something to the name
        break;

      default:
    }

    const obj = await this.getValObj(minmaxStateNameToday); // get old min/max value

    if (obj !== null) {
      if (now.getDay() === oldNow.getDay()) { // same day
        let newMinmaxValue;
        if (obj.val !== stateValue) {
          switch (calcType) {
            case MIN:
              newMinmaxValue = Math.min(obj.val, stateValue); // calculate new min value
              break;

            case MAX:
              newMinmaxValue = Math.max(obj.val, stateValue); // calculate new min value
              break;

            default:
          }
          this.myCreateState(minmaxStateNameToday, minmaxStateParametersToday, newMinmaxValue); // create and/or write node
        }
      } else { // new day, always update
        this.myCreateState(minmaxStateNameToday, minmaxStateParametersToday, stateValue); // On a new day, first value is the minimum of 'today'
        this.myCreateState(minmaxStateNameYesterday, minmaxStateParametersYesterday, obj.val); // Values for yesterday are last min value from today
      }
    } else { // min or max state does not yet exist
      this.myCreateState(minmaxStateNameToday, minmaxStateParametersToday, stateValue); // if not existing, create
    }
  }
}

// @ts-ignore parent is a valid property on module
if (module.parent) {
  // Export the constructor in compact mode
  /**
     * @param {Partial<utils.AdapterOptions>} [options={}]
     */
  module.exports = (options) => new WeatherflowUdp(options);
} else {
  // otherwise start the instance directly
  new WeatherflowUdp();
}

/**
 * QFF: Convert local absolute air pressure to seal level (DWD formula); http://dk0te.ba-ravensburg.de/cgi-bin/navi?m=WX_BAROMETER
 * @param {number} temperature The local air temperature in °C
 * @param {number} airPressureAbsolute The local station air pressure in hPa
 * @param {number} altitude The station altitude in m
 * @param {number} humidity The local air humidity
 * @returns {number}
 */
function getQFF(temperature, airPressureAbsolute, altitude, humidity) {
  const g_n = 9.80665; // Erdbeschleunigung (m/s^2)
  const gam = 0.0065; // Temperaturabnahme in K pro geopotentiellen Metern (K/gpm)
  const R = 287.06; // Gaskonstante für trockene Luft (R = R_0 / M)
  // const M = 0.0289644; // Molare Masse trockener Luft (J/kgK)
  // const R_0 = 8.314472; // allgemeine Gaskonstante (J/molK)
  const T_0 = 273.15; // Umrechnung von °C in K
  const C = 0.11; // DWD-Beiwert für die Berücksichtigung der Luftfeuchte

  const E_0 = 6.11213; // (hPa)
  const f_rel = humidity / 100; // relative Luftfeuchte (0-1.0)
  // momentaner Stationsdampfdruck (hPa)
  const e_d = f_rel * E_0 * Math.exp((17.5043 * temperature) / (241.2 + temperature));

  const reducedPressure = Math.round(10 * airPressureAbsolute * Math.exp((g_n * altitude) / (R * (temperature + T_0 + C * e_d + ((gam * altitude) / 2))))) / 10;

  return reducedPressure;
}

/**
 * Calculate dewpoint; Formula: https://www.wetterochs.de/wetter/feuchte.html
 * @param {number} temperature The local air temperature in °C
 * @param {number} humidity The local air humidity
 * @returns {number}
 */
function dewpoint(temperature, humidity) {
  let a;
  let b;

  if (temperature >= 0) {
    a = 7.5;
    b = 237.3;
  } else {
    a = 7.6;
    b = 240.7;
  }

  const SDD = 6.1078 * 10 ** ((a * temperature) / (b + temperature));
  const DD = (humidity / 100) * SDD;

  const v = Math.log(DD / 6.1078) / Math.log(10);
  const dewpointTemp = Math.round(((b * v) / (a - v)) * 10) / 10;
  return dewpointTemp;
}

/**
 * Convert wind speed from m/s to beauforts
 * @param {number} windspeed Wind speed in m/s
 * @returns {number} Beaufort wind value
 */
function beaufort(windspeed) {
  let beaufortWind = 0;

  // max wind speeds m/s to Beaufort
  const beauforts = {
    0: '0',
    0.3: '1',
    1.5: '2',
    3.3: '3',
    5.4: '4',
    7.9: '5',
    10.7: '6',
    13.8: '7',
    17.1: '8',
    20.7: '9',
    24.4: '10',
    28.4: '11',
    32.6: '12',
  };

  Object.keys(beauforts).forEach((item) => {
    if (windspeed > parseFloat(item)) {
      beaufortWind = beauforts[item];
    }
  });

  return beaufortWind;
}

/**
 * Convert wind speed from m/s to beauforts
 * @param {number} temperature The local air temperature in °C
 * @param {number} windspeed The current wind speed in m/s
 * @param {number} humidity The local air humidity in %
 * @returns {number} Feels like temperature in °C
 */
function feelsLike(temperature, windspeed, humidity) {
  let feelsLikeTemperature;
  if (temperature >= 26.7 && humidity >= 40) { // heat index (https://de.wikipedia.org/wiki/Hitzeindex)
    feelsLikeTemperature = (-8.784695 + 1.61139411 * temperature + 2.338549 * humidity);
    feelsLikeTemperature += (-0.14611605 * temperature * humidity);
    feelsLikeTemperature += (-0.012308094 * (temperature ** 2));
    feelsLikeTemperature += (-0.016424828 * (humidity ** 2));
    feelsLikeTemperature += (0.002211732 * (temperature ** 2) * humidity);
    feelsLikeTemperature += (0.00072546 * temperature * (humidity ** 2));
    feelsLikeTemperature += (-0.000003582 * (temperature ** 2) * (humidity ** 2));
  } else if (temperature < 10 && windspeed > (5 / 3.6)) { // wind chill (https://de.wikipedia.org/wiki/Windchill)
    feelsLikeTemperature = 13.12 + 0.6215 * temperature + ((0.3965 * temperature) - 11.37) * ((windspeed * 3.6) ** 0.16);
  } else {
    feelsLikeTemperature = temperature;
  }
  feelsLikeTemperature = Math.round(feelsLikeTemperature * 10) / 10;  // round to 1 decimal only

  return feelsLikeTemperature;
}
