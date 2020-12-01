"use strict";

/*
 * Created with @iobroker/create-adapter v1.25.0
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const utils = require("@iobroker/adapter-core");

// Load your modules here, e.g.:
const dgram = require("dgram");
const { join } = require("path");

//const timezone = this.config.timezone || "Europe/Berlin";

let mServer = null;
let adapter;

var now = new Date();   //set as system time for now, will be overwritten if timestamp is recieved
var oldNow = new Date(); //set as system time for now, will be overwritten if timestamp is recieved

//Import constants with static interpretation data
const { devices,messages,windDirections,minCalcs,maxCalcs,sensorfails} = require(__dirname + '/lib/messages')

class WeatherflowUdp extends utils.Adapter {

    /**
     * @param {Partial<utils.AdapterOptions>} [options={}]
     */
    constructor(options) {
        super({
            ...options,
            name: "weatherflow_udp",
        });
        this.on("ready", this.onReady.bind(this));
        this.on("unload", this.onUnload.bind(this));
        this.on('stateChange', this.onStateChange.bind(this));
    }

    /**
     * Is called when databases are connected and adapter received configuration.
     */
    async onReady() {
        // Initialize your adapter here
        this.main();

    };


    async main() {
        let that = this;
        
        mServer = dgram.createSocket("udp4");

        //Attach to UDP Port
        try {
            mServer.bind(this.config.UDP_port, '0.0.0.0');
        }
        catch (e) {
            that.log.error(["Could not bind to port: ", this.config.UDP_port,". Adapter stopped."].join(""));
        }

        mServer.on("error", err => {
            that.log.error(`Cannot open socket:\n${err.stack}`);
            mServer.close();
            setTimeout(() => process.exit(), 1000); //delay needed to wait for logging
        });

        // Reset the connection indicator during startup
        this.setState("info.connection", false, true);

        mServer.on("listening", () => {
            const address = mServer.address();
            that.log.info(`adapter listening ${address.address}:${address.port}`);
        });

        //Receive UDP message
        mServer.on("message", (messageString, rinfo) => {

            var message;    //JSON parsed message

            if (that.config.debug)
                that.log.debug(rinfo.address + ":" + rinfo.port + " - " + messageString.toString("ascii"));

            try {
                message = JSON.parse(messageString);
            }
            catch (e) {
                // Anweisungen für jeden Fehler
                that.log.warn(["Non-JSON message received: '", message, "'. Ignoring."].join(""));
                return 0
            }

            //stop processing if message does not have a type
            if ("type" in message == false) {
                that.log.warn(["Non- or unknown weatherflow message received: '", message, "'. Ignoring."].join(""));
                return 0
            }

            //Set connection state when message received and expire after 5 minutes of inactivity
           that.setStateAsync("info.connection", { val: true, ack: true, expire: 600 });

            var messageType = message.type;  //e.g. "rapid_wind"



            if (that.config.debug)
                that.log.info(["Message type: '", message.type, "'"].join(""));

            var messageInfo = messages[messageType];

            if (that.config.debug)
                that.log.info(["messageInfo: ", JSON.stringify(messageInfo)].join(''));

            var statePath;  //name of current state to set or create

            if (!messageInfo) {
                if (that.config.debug)
                    that.log.info(["Unknown message type: ", messageType, " - ignoring"].join(''));
            } else {
                if (that.config.debug)
                    that.log.info(["messageInfo: ", JSON.stringify(messageInfo)].join(''));

                if ("serial_number" in message) {   //create structure for device

                    if ('hub_sn' in message) { //device message with serial and hub serial

                        //Create state for hub
                        var hubType = devices[message.hub_sn.substring(0, 2)];          //Get type from first 2 characters of serial number

                        var hub_snParameters = {
                            type: "device",
                            common: {
                                name: hubType + ": " + message.hub_sn,
                            },
                            native: {},
                        };
                        
                        that.myCreateState(message.hub_sn, hub_snParameters);  //create device

                        var deviceType = devices[message.serial_number.substring(0, 2)];         //Get type from first 2 characters of serial number

                        var serialParameters = {
                            type: "device",
                            common: {
                                name: deviceType + ": " + message.serial_number,
                            },
                            native: {},
                        };

                        that.myCreateState(message.hub_sn + "." + message.serial_number, serialParameters);  //create device

                        //Set complete path to state hub and serial
                        statePath = [message.hub_sn, ".", message.serial_number, ".", message.type].join("");

                    } else {    //device message without hub serial (probably only hub)

                        var deviceType = devices[message.serial_number.substring(0, 2)];     //Get type from first 2 characters of serial number

                        var serialParameters = {
                            type: "device",
                            common: {
                                name: deviceType + ": " + message.serial_number,
                            },
                            native: {},
                        };
                        
                        that.myCreateState(message.serial_number, serialParameters);  //create device

                        //Set path to state
                        statePath = [message.serial_number, ".", message.type].join("");

                    }
                }


                if (that.config.debug)
                    that.log.info(["statepath: ", statePath].join(""));

                //Write last message to the node lastMessage in statepath
                var lastMessageParameter = {
                    type: "state",
                    common: {
                        name: "lastMessage on this channel",
                        type: "string",
                        role: "indicator",
                        read: true,
                        write: false,
                    },
                    native: {},
                };
                
                that.myCreateState([statePath,"lastMessage"].join("."), lastMessageParameter, messageString.toString("ascii"));  //create/update lestMessage state per message type


                //Walk through items of message
                Object.keys(message).forEach(function (item) {

                    var itemvalue = Array();

                    if (typeof message[item][0] == "object") {    //some items like "obs" are double arrays [[]], remove outer array
                        itemvalue = message[item][0];
                    } else if (typeof message[item] == "object") {    //some are arrays, take as is
                        itemvalue = message[item];
                    } else if (typeof message[item] == "number" || typeof message[item] == "string") {    //others are just numbers or strings, then wrap into an array
                        itemvalue.push(message[item]);
                    }

                    if (that.config.debug)
                        that.log.info(["item: ", item, " = ", itemvalue].join(""));

                    //Set some Items to be ignored later as they are parsed differently
                    var ignoreItems = ["type", "serial_number", "hub_sn"];

                    //Check for unknown/new items
                    if ((item in messageInfo) == false && ignoreItems.includes(item) == false) {
                            that.log.warn(["Message ", messageType, " contains unknown parameter: ", item, " = ", itemvalue, ". Ignoring. Please check UDP message version and check with adapter developer."].join(''));
                    }

                    if (messageInfo[item] && ignoreItems.includes(item) == false) {      //only parse if part of "states" definition

                        //Walk through fields 0 ... n
                        Object.keys(itemvalue).forEach(async function (field) {

                            if (!messageInfo[item][field]) {
                                that.log.warn(["Message contains unknown field '(", field, "' in message '", item, ")'. Check UDP message version and inform adapter developer."].join(''))
                                return 0;
                            }

                            var pathParameters = {
                                type: "channel",
                                common: {
                                    name: messageInfo["name"],
                                },
                                native: {},
                            };
                            var stateParameters = messageInfo[item][field][1];
                            var stateName = [statePath, messageInfo[item][field][0]].join('.');
                            var fieldvalue = itemvalue[field];

                            if (messageInfo[item][field][0] == 'timestamp') { //timestamp in iobroker is milliseconds and date
                                fieldvalue = new Date(fieldvalue * 1000);
                            }

                            if (that.config.debug)
                                that.log.info(["[", field, "] ", "state: ", stateName, " = ", fieldvalue].join(""));

                            //handle timestamp old and new
                            //save current timestamp as now for later use when occuring and retrieve previous timestamp before overwriting
                            if (messageInfo[item][field][0]=='timestamp') {
                                now=new Date(fieldvalue);   //now is date/time of current message
                                try { 
                                    const obj = await that.getStateAsync(stateName);    //get value from previous message
                                    oldNow = new Date(obj.val);
                                } catch (err) {
                                    // handle error
                                }
                            }

                            //Special corrections on data
                            //======================================

                            if (messageInfo[item][field][0] == "lightningStrikeAvgDistance" && fieldvalue == 0) {
                                fieldvalue = 999; //If average lightning distance is zero, no lightning was detected, set to 999 to mark this fact
                            }

                            //Walkaround for for occasional 0-pressure values
                            if (messageInfo[item][field][0] == "stationPressure" && fieldvalue == 0) {
                                return;     //skip value if this happens
                            }

                            //Calculate minimum values of today and yesterday for native values
                           
                            //Min-values
                            if (minCalcs.includes(messageInfo[item][field][0])) { 
                                that.calcMinMaxValue(stateName, stateParameters, fieldvalue, "min");
                            }

                            //Max-values
                            if (maxCalcs.includes(messageInfo[item][field][0])) {
                                that.calcMinMaxValue(stateName, stateParameters, fieldvalue, "max");
                            }

                            //And update states
                            //=============
                            that.myCreateState(statePath, pathParameters);  //create channel
                            that.myCreateState(stateName, stateParameters, fieldvalue); //create node


                            //======================================
                            //Do special tasks based on message type 
                            //======================================

                            //rain accumulation and time of current and previous hour
                            //-------------------------------------------------------
                            if (messageInfo[item][field][0] == "precipAccumulated") {

                                //rain amount
                                var stateNameCurrentHour = [statePath, "precipAccumulatedCurrentHour"].join(".");
                                var stateParametersCurrentHour = { type: "state", common: { type: "number", unit: "mm", read: true, write: false, role: "state", name: "Accumulated rain in current hour; adapter calculated" }, native: {}, };

                                var stateNamePreviousHour = [statePath, "precipAccumulatedPreviousHour"].join(".");
                                var stateParametersPreviousHour = { type: "state", common: { type: "number", unit: "mm", read: true, write: false, role: "state", name: "Accumulated rain in previous hour; adapter calculated" }, native: {}, };

                                var stateNameToday = [statePath, "precipAccumulatedToday"].join(".");
                                var stateParametersToday = { type: "state", common: { type: "number", unit: "mm", read: true, write: false, role: "state", name: "Accumulated rain today; adapter calculated" }, native: {}, };

                                var stateNameYesterday = [statePath, "precipAccumulatedYesterday"].join(".");
                                var stateParametersYesterday = { type: "state", common: { type: "number", unit: "mm", read: true, write: false, role: "state", name: "Accumulated rain yesterday; adapter calculated" }, native: {}, };

                                var newValueHour=0;
                                var newValueDay=0;

                                try {   //hour
                                    const objhour = await that.getStateAsync(stateNameCurrentHour); //get old value

                                    if (now.getHours() == oldNow.getHours()) {      //same hour
                                        newValueHour = objhour.val + fieldvalue;            //add
                                    } else {                                        //different hour
                                        newValueHour=fieldvalue;                        //replace
                                        that.myCreateState(stateNamePreviousHour, stateParametersPreviousHour, objhour.val);    //save value from current hour to last hour
                                    }

                                } catch (err) {
                                    //error handling    
                                }                                  

                                that.myCreateState(stateNameCurrentHour, stateParametersCurrentHour, newValueHour);    //always write value for current hour

                                try {   //day
                                    const objday = await that.getStateAsync(stateNameToday); //get old value

                                    if (now.getDay() == oldNow.getDay()) {      //same hour
                                        newValueDay = objday.val + fieldvalue;            //add
                                    } else {                                        //different hour
                                        newValueDay = fieldvalue;                        //replace
                                        that.myCreateState(stateNameYesterday, stateParametersYesterday, objday.val);    //save value from current day to yesterday
                                    }

                                } catch (err) {
                                    //error handling    
                                }

                                that.myCreateState(stateNameToday, stateParametersToday, newValueDay);    //always write value for current day

                                
                                //rain duration
                                var stateNameCurrentHour = [statePath, "precipDurationCurrentHour"].join(".");
                                var stateParametersCurrentHour = { type: "state", common: { type: "number", unit: "min", read: true, write: false, role: "state", name: "Rain duration in current hour; adapter calculated" }, native: {}, };

                                var stateNamePreviousHour = [statePath, "precipDurationPreviousHour"].join(".");
                                var stateParametersPreviousHour = { type: "state", common: { type: "number", unit: "min", read: true, write: false, role: "state", name: "Rain duration in previous hour; adapter calculated" }, native: {}, };

                                var stateNameToday = [statePath, "precipDurationToday"].join(".");
                                var stateParametersToday = { type: "state", common: { type: "number", unit: "h", read: true, write: false, role: "state", name: "Rain duration today; adapter calculated" }, native: {}, };

                                var stateNameYesterday = [statePath, "precipDurationYesterday"].join(".");
                                var stateParametersYesterday = { type: "state", common: { type: "number", unit: "h", read: true, write: false, role: "state", name: "Rain duration yesterday; adapter calculated" }, native: {}, };

                                var reportIntervalName = [statePath, "reportInterval"].join(".");

                                var newValueHour;
                                var newValueDay;

                                try {   //hour
                                    const objhour = await that.getStateAsync(stateNameCurrentHour); //get old value
                                    const reportInterval = await that.getStateAsync(reportIntervalName);

                                    if (now.getHours() == oldNow.getHours()) {      //same hour
                                        if (fieldvalue>0) {
                                            newValueHour = objhour.val + reportInterval.val;            //add
                                        }
                                    } else {                                        //different hour
                                        if (fieldvalue>0) {
                                            newValueHour = reportInterval.val;                        //replace
                                        } else {
                                            newValueHour = 0; 
                                        }
                                        that.myCreateState(stateNamePreviousHour, stateParametersPreviousHour, objhour.val);    //save value from current hour to last hour
                                    }

                                } catch (err) {
                                    //error handling    
                                }

                                that.myCreateState(stateNameCurrentHour, stateParametersCurrentHour, newValueHour);    //always write value for current hour

                                try {   //day
                                    const objday = await that.getStateAsync(stateNameToday); //get old value
                                    const reportInterval = await that.getStateAsync(reportIntervalName);

                                    if (now.getDay() == oldNow.getDay()) {      //same day
                                        if (fieldvalue > 0) {
                                            newValueDay = objday.val + reportInterval.val/60;            //add
                                        } else {
                                            newValueDay = objday.val;    
                                        }
                                    } else {                                        //different day
                                        if (fieldvalue > 0) {
                                            newValueDay = reportInterval.val/60;                        //replace
                                        } else {
                                            newValueDay = 0;
                                        }
                                        that.myCreateState(stateNameYesterday, stateParametersYesterday, objday.val);    //save value from current day to last yesterday
                                    }

                                } catch (err) {
                                    //error handling    
                                }

                                that.myCreateState(stateNameToday, stateParametersToday, newValueDay);    //always write value for current day

                            }

                            //sunshine duration of previous and current hour, today and last day
                            //------------------------------------------------------------------
                            if (messageInfo[item][field][0] == "solarRadiation") {
                                //sunshine duration
                                const SUNSHINETHRESHOLD = 120;     //If radiation is more than 120 W/m2 it is counted as sunshine (https://de.wikipedia.org/wiki/Sonnenschein)

                                var stateNameCurrentHour = [statePath, "sunshineDurationCurrentHour"].join(".");
                                var stateParametersCurrentHour = { type: "state", common: { type: "number", unit: "min", read: true, write: false, role: "state", name: "Sunshine duration in current hour; adapter calculated" }, native: {}, };

                                var stateNamePreviousHour = [statePath, "sunshineDurationPreviousHour"].join(".");
                                var stateParametersPreviousHour = { type: "state", common: { type: "number", unit: "min", read: true, write: false, role: "state", name: "Sunshine duration in previous hour; adapter calculated" }, native: {}, };

                                var stateNameToday = [statePath, "sunshineDurationToday"].join(".");
                                var stateParametersToday = { type: "state", common: { type: "number", unit: "h", read: true, write: false, role: "state", name: "Sunshine duration today; adapter calculated" }, native: {}, };

                                var stateNameYesterday = [statePath, "sunshineDurationYesterday"].join(".");
                                var stateParametersYesterday = { type: "state", common: { type: "number", unit: "h", read: true, write: false, role: "state", name: "Sunshine duration yesterday; adapter calculated" }, native: {}, };

                                var reportIntervalName = [statePath, "reportInterval"].join(".");

                                var newValueHour;
                                var newValueDay;


                                try {   //hour
                                    const objhour = await that.getStateAsync(stateNameCurrentHour); //get old value
                                    const reportInterval = await that.getStateAsync(reportIntervalName);

                                    if (now.getHours() == oldNow.getHours()) {      //same hour
                                        if (fieldvalue > SUNSHINETHRESHOLD) {
                                            newValueHour = objhour.val + reportInterval.val;            //add
                                        }
                                    } else {                                        //different hour
                                        if (fieldvalue > SUNSHINETHRESHOLD) {
                                            newValueHour = reportInterval.val;                        //replace
                                        } else {
                                            newValueHour = 0;
                                        }
                                        that.myCreateState(stateNamePreviousHour, stateParametersPreviousHour, objhour.val);    //save value from current hour to last hour
                                    }

                                } catch (err) {
                                    //error handling    
                                }

                                that.myCreateState(stateNameCurrentHour, stateParametersCurrentHour, newValueHour);    //always write value for current hour

                                try {   //day
                                    const objday = await that.getStateAsync(stateNameToday); //get old value
                                    const reportInterval = await that.getStateAsync(reportIntervalName);

                                    if (now.getDay() == oldNow.getDay()) {      //same day
                                        if (fieldvalue > SUNSHINETHRESHOLD) {
                                            newValueDay = objday.val + reportInterval.val / 60;            //add
                                        } else {
                                            newValueDay = objday.val;
                                        }
                                    } else {                                        //different hour
                                        if (fieldvalue > SUNSHINETHRESHOLD) {
                                            newValueDay = reportInterval.val / 60;                        //replace
                                        } else {
                                            newValueDay = 0;
                                        }
                                        that.myCreateState(stateNameYesterday, stateParametersYesterday, objday.val);    //save value from current day to last yesterday
                                    }

                                } catch (err) {
                                    //error handling    
                                }

                                that.myCreateState(stateNameToday, stateParametersToday, newValueDay);    //always write value for current day

                            }


                            //Reduced pressure (sea level) from station pressure
                            //--------------------------------------------------
                            if (messageInfo[item][field][0] == "stationPressure") {
                                var airTemperature=15;  //standard value if not available
                                var relativeHumidity = 50; //standard value if not available

                                var stateNameAirTemperature = [statePath, "airTemperature"].join(".");
                                var stateNameRelativeHumidity = [statePath, "relativeHumidity"].join(".");
                                var stateNameReducedPressure = [statePath, "reducedPressure"].join(".");
                                var stateParametersReducedPressure = { type: "state", common: { type: "number", unit: "hPa", read: true, write: false, role: "state", name: "Reduced pressure (sea level); adapter calculated" }, native: {}, };

                                try {
                                    const obj1 = await that.getStateAsync(stateNameAirTemperature);
                                    airTemperature = obj1.val;
                                    const obj2 = await that.getStateAsync(stateNameRelativeHumidity);
                                    relativeHumidity = obj2.val;

                                    var reducedPressure = getQFF(airTemperature, fieldvalue, that.config.height, relativeHumidity);

                                    //Calculate min/max for reduced pressure
                                    that.calcMinMaxValue(stateNameReducedPressure, stateParametersReducedPressure, reducedPressure, "min");
                                    that.calcMinMaxValue(stateNameReducedPressure, stateParametersReducedPressure, reducedPressure, "max");

                                    that.myCreateState(stateNameReducedPressure, stateParametersReducedPressure, reducedPressure);

                                    if (that.config.debug)
                                        that.log.info(["Pressure conversion: ", "Station pressure: ", fieldvalue, ", Height: ", that.config.height, ", Temperature: ", airTemperature, ", Humidity: ", relativeHumidity, ", Reduced pressure: ", reducedPressure].join(''));

                                } catch (err) {
                                    // error handling
                                }
                            }

                            //Dewpoint from temperature and humidity
                            //----------------------------------------------
                            //Is calculated and written when humidity is received (temperature comes before that, so it should be current)
                            if (messageInfo[item][field][0] == "relativeHumidity") {

                                var stateNameAirTemperature = [statePath, "airTemperature"].join(".");
                                var stateNameDewpoint = [statePath, "dewpoint"].join(".");
                                var stateParametersDewpoint = { type: "state", common: { type: "number", unit: "°C", read: true, write: false, role: "state", name: "Dewpoint; adapter calculated" }, native: {}, };

                                try {
                                    const obj1 = await that.getStateAsync(stateNameAirTemperature);
                                    var airTemperature = obj1.val;

                                    //Calculate min/max for dewpoint
                                    that.calcMinMaxValue(stateNameDewpoint, stateParametersDewpoint, dewpoint(airTemperature, fieldvalue), "min");
                                    that.calcMinMaxValue(stateNameDewpoint, stateParametersDewpoint, dewpoint(airTemperature, fieldvalue), "max");

                                    that.myCreateState(stateNameDewpoint, stateParametersDewpoint, dewpoint(airTemperature, fieldvalue));

                                } catch (err) {
                                    // error handling
                                }

                            }

                            //Feels like from temperature and humidity and wind
                            //-------------------------------------------------
                            //Is calculated and written when humidity is received (wind and temperature comes before that, so they should be current)
                            if (messageInfo[item][field][0] == "relativeHumidity") {

                                var stateNameAirTemperature = [statePath, "airTemperature"].join(".");
                                var stateNameFeelsLike = [statePath, "feelsLike"].join(".");
                                var stateNameWindAvg = [statePath, "windAvg"].join(".");
                                var stateParametersFeelsLike = { type: "state", common: { type: "number", unit: "°C", read: true, write: false, role: "state", name: "Feels like temperature (Heat index/wind chill), °C; adapter calculated" }, native: {}, };

                                try {
                                    const obj1 = await that.getStateAsync(stateNameAirTemperature);
                                    var airTemperature = obj1.val;
                                    const obj2 = await that.getStateAsync(stateNameWindAvg);
                                    var windAvg = obj2.val;

                                    //Calculate min/max for feelsLike
                                    that.calcMinMaxValue(stateNameFeelsLike, stateParametersFeelsLike, feelsLike(airTemperature, windAvg, fieldvalue), "min");
                                    that.calcMinMaxValue(stateNameFeelsLike, stateParametersFeelsLike, feelsLike(airTemperature, windAvg, fieldvalue), "max");

                                    that.myCreateState(stateNameFeelsLike, stateParametersFeelsLike, feelsLike(airTemperature, windAvg, fieldvalue));

                                } catch (err) {
                                    // error handling
                                }

                            }


                            //Convert wind directions from degrees to cardinal directions
                            //-----------------------------------------------------------                      
                            if (messageInfo[item][field][0] == "windDirection") {
                                var stateNameWindDirectionText = [statePath, "windDirectionCardinal"].join(".");
                                var stateParametersWindDirectionText = { type: "state", common: { type: "string", unit: "", read: true, write: false, role: "state", name: "Cardinal wind direction; adapter calculated" }, native: {}, };                                
                             
                                that.myCreateState(stateNameWindDirectionText, stateParametersWindDirectionText, windDirections[Math.round(fieldvalue / 22.5)]);
                            }


                            //Convert wind speed from m/s to Beaufort
                            //---------------------------------------                      
                            if (["windSpeed", "windGust", "windLull", "windAvg"].includes(messageInfo[item][field][0])) {

                                switch (messageInfo[item][field][0]) {
                                    case "windGust":
                                    var stateNameBeaufort = [statePath, "beaufortGust"].join(".");
                                    break;
                                    
                                    case "windLull":
                                    var stateNameBeaufort = [statePath, "beaufortLull"].join(".");
                                    break;

                                    case "windAvg":
                                    var stateNameBeaufort = [statePath, "beaufortAvg"].join(".");
                                    break;

                                    default:
                                    var stateNameBeaufort = [statePath, "beaufort"].join(".");
                                }
                                
                                var stateParametersBeaufort = { type: "state", common: { type: "number", unit: "", read: true, write: false, role: "state", name: "Wind speed in Beaufort; adapter calculated" }, native: {}, };

                                //Calculate max for beaufort windspeeds
                                that.calcMinMaxValue(stateNameBeaufort, stateParametersBeaufort, beaufort(fieldvalue), "max");
                                
                                //Write new value to state (or create first, if needed)
                                that.myCreateState(stateNameBeaufort, stateParametersBeaufort, beaufort(fieldvalue));
                            }
                           
                            //Sensor status as text from binary
                            //---------------------------------
                            if (messageInfo[item][field][0] == "sensor_status") {
                                var sensorStatusText="";
                                var stateNameSensorStatusText = [statePath, "sensor_statusText"].join(".");
                                var stateParametersSensorStatusText = { type: "state", common: { type: "string", unit: "", read: true, write: false, role: "state", name: "Sensor status; adapted calculated" }, native: {}, };                                
                                Object.keys(sensorfails).forEach(function (item) {
                                    if ((fieldvalue & parseInt(item)) == parseInt(item)) {
                                        if (sensorStatusText!="") {
                                            sensorStatusText += ", ";    
                                        }
                                        sensorStatusText+=sensorfails[item];
                                    }
                                    if (sensorStatusText == "") {
                                        sensorStatusText = "Sensors OK";
                                    }
                                });
                                that.myCreateState(stateNameSensorStatusText, stateParametersSensorStatusText, sensorStatusText);
                            }


                            //==============================
                            //End of special tasks section


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
            clearTimeout();     //stop timeout from loggin at stop
            mServer.close();     //close UDP port
            this.log.info("cleaned everything up...");
            callback();
        } catch (e) {
            callback();
        }
    }  


    /**
     * Is called if a subscribed state changes
     * @param {string} id
     * @param {ioBroker.State | null | undefined} state
     */
    onStateChange(id, state) {
        if (state) {
            // The state was changed
            this.log.info(`state ${id} changed: ${state.val} (ack = ${state.ack})`);
        } else {
            // The state was deleted
            this.log.info(`state ${id} deleted`);
        }
    }

    /**
    * Write value to state or create if not already existing
    * @param {string} stateName The full path and name of the state to be created
    * @param {object} stateParameters Set of parameters for creation of state
    * @param {number | string | null} stateValue Value of the state (optional)
    */
    async myCreateState(stateName, stateParameters, stateValue = null) {

        await this.getObjectAsync(stateName, async (err, obj) => {
            // catch error
            if (err)
                this.log.info(err);

            // create node if non-existent
            if (err || !obj) {
                this.log.info('Creating node: ' + stateName);
                await this.setObjectAsync(stateName, stateParameters);
            }
            //and set value if provided
            if (stateValue != null) {
                await this.setState(stateName, { val: stateValue, ack: true });
            }
        });

    }


    /**
    * Calculate min/max for today and yesterday
    * @param {string} stateName The full path and name of the state to be created
    * @param {object} stateParameters Set of parameters for creation of state
    * @param {number | string | null} stateValue Value of the state (optional)
    * @param {string} calcType "min" or "max" to calculate minimum or maximum value
    */
    async calcMinMaxValue(stateName,stateParameters,stateValue,calcType) {

        const stateparts = stateName.split('.');    //spit statename to insert min/max today/yesterday as levels

        var i=1;
        var state = stateparts[stateparts.length-1];
        var stateBase = stateparts[0];

        while (i<stateparts.length-1) {
            stateBase=[stateBase,stateparts[i]].join(".");
            i++;
        }

        var minmaxStateParametersToday = JSON.parse(JSON.stringify(stateParameters)); //Make a real copy not just an addtl. reference
        var minmaxStateParametersYesterday = JSON.parse(JSON.stringify(stateParameters));  //Take parameters from main value ...   

        if (calcType == "min") {
            var minmaxStateNameToday = stateBase + ".today.min."+state;                         //create state name
            minmaxStateParametersToday.common.name += " / today / min; adapter calculated";   //... and add something to the name
            var minmaxStateNameYesterday = stateBase + ".yesterday.min." + state;               //create state name
            minmaxStateParametersYesterday.common.name += " / min / yesterday; adapter calculated";   //... and add something to the name
        
        } else if (calcType == "max") {
            var minmaxStateNameToday = stateBase + ".today.max." + state;                           //create state name
            minmaxStateParametersToday.common.name += " / today / max; adapter calculated";   //... and add something to the name
            var minmaxStateNameYesterday = stateBase + ".yesterday.max." + state;                   //create state name
            minmaxStateParametersYesterday.common.name += " / yesterday / max; adapter calculated";   //... and add something to the name
        }

        try {
            const obj = await this.getStateAsync(minmaxStateNameToday);    //get old min/max value
            if (now.getDay() == oldNow.getDay()) {  //same day
                if (calcType=="min") {
                    var newMinmaxValue = Math.min(obj.val, stateValue);   //calculate new min value
                } else if (calcType == "max") {
                    var newMinmaxValue = Math.max(obj.val, stateValue);   //calculate new min value                
                }
                if (newMinmaxValue != obj.val) { //only update today if new minmax value is different
                    this.myCreateState(minmaxStateNameToday, minmaxStateParametersToday, newMinmaxValue); //create and/or write node    
                }
            } else { //new day, always update
                this.myCreateState(minmaxStateNameToday, minmaxStateParametersToday, stateValue); //On a new day, first value is the minimum of "today"  
                this.myCreateState(minmaxStateNameYesterday, minmaxStateParametersYesterday, obj.val); //Values for yesterday are last min value from today                                        
            }

        }
        catch (err) { //min or max state does not yet exist
            // handle error
            this.myCreateState(minmaxStateNameToday, minmaxStateParametersToday, stateValue);    //if not existing, create
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

//function writeNode() 
/**
 * @param {any} needle
 * @param {array} haystack
 */
function inArray(needle, haystack) {
    var length = haystack.length;
    for (var i = 0; i < length; i++) {
        if (haystack[i] == needle) return true;
    }
    return false;
}

/**
 * QFF: Convert local absolute air pressure to seal level (DWD formula); http://dk0te.ba-ravensburg.de/cgi-bin/navi?m=WX_BAROMETER
 * @param {float} temperature The local air temperature in °C
 * @param {float} airPressureAbsolute The local station air pressure in hPa
 * @param {float} altitude The station altitude in m
 * @param {float} humidity The local air humidity
 * @returns {float}
 */
function getQFF(temperature, airPressureAbsolute, altitude, humidity) {
    var g_n = 9.80665;                // Erdbeschleunigung (m/s^2)
    var gam = 0.0065;                // Temperaturabnahme in K pro geopotentiellen Metern (K/gpm)
    var R = 287.06;                // Gaskonstante für trockene Luft (R = R_0 / M)
    var M = 0.0289644;                // Molare Masse trockener Luft (J/kgK)
    var R_0 = 8.314472;            // allgemeine Gaskonstante (J/molK)
    var T_0 = 273.15;                // Umrechnung von °C in K
    var C = 0.11;                // DWD-Beiwert für die Berücksichtigung der Luftfeuchte

    var E_0 = 6.11213;                // (hPa)
    var f_rel = humidity / 100;        // relative Luftfeuchte (0-1.0)
    // momentaner Stationsdampfdruck (hPa)
    var e_d = f_rel * E_0 * Math.exp((17.5043 * temperature) / (241.2 + temperature));

    var reducedPressure = Math.round(10*airPressureAbsolute * Math.exp((g_n * altitude) / (R * (temperature + T_0 + C * e_d + ((gam * altitude) / 2)))))/10;

    return reducedPressure;
}


/**
 * Calculate dewpoint; Formula: https://www.wetterochs.de/wetter/feuchte.html
 * @param {float} temperature The local air temperature in °C
 * @param {float} humidity The local air humidity
 * @returns {float}
 */
function dewpoint(temperature,humidity) {

    var a;
    var b;

    if (temperature >= 0) {
        a = 7.5;
        b = 237.3;
    } else {
        a = 7.6;
        b = 240.7;
    }

    var SDD = 6.1078 * Math.pow(10, ((a * temperature) / (b + temperature)));
    var DD = humidity / 100 * SDD;

    var v = Math.log(DD / 6.1078) / Math.log(10);
    var dewpoint = Math.round((b * v / (a - v)) * 10) / 10;
    return dewpoint;

}

/**
 * Canvert wind speed from m/s to beauforts
 * @param {float} windspeed Wind speed in m/s
 * @returns {float} Beaufort wind value
 */
function beaufort(windspeed) {
    var beaufort=0;
    
    //max wind speeds m/s to Beaufort
    const beauforts = {
        "0": "0",
        "0.3": "1",
        "1.5": "2",
        "3.3": "3",
        "5.4": "4",
        "7.9": "5",
        "10.7": "6",
        "13.8": "7",
        "17.1": "8",
        "20.7": "9",
        "24.4": "10",
        "28.4": "11",
        "32.6": "12",
    };

    Object.keys(beauforts).forEach(function (item) {
        if (windspeed>item) {
            beaufort=beauforts[item];
        }        
    });

    return beaufort;
}



/**
 * Canvert wind speed from m/s to beauforts
 * @param {float} temperature The local air temperature in °C
 * @param {float} windspeed The current wind speed in m/s
 * @param {float} humidity The local air humidity in % 
 * @returns {float} Feels like temperature in °C
 */
function feelsLike(temperature, windspeed, humidity) {
    var feelsLike=temperature;
    if (temperature >= 26.7 && humidity >= 40) {    //heat index (https://de.wikipedia.org/wiki/Hitzeindex)
        feelsLike = (-8.784695 + 1.61139411 * temperature + 2.338549 * humidity) + (-0.14611605 * temperature * humidity) + (-0.012308094 * temperature * temperature) + (-0.016424828 * humidity * humidity) + (0.002211732 * temperature * temperature * humidity) + (0.00072546 * temperature * humidity * humidity) + (-0.000003582*temperature*temperature*humidity*humidity); 
    } else if (temperature < 10 && windspeed > 1.4) {   //wind chill (https://de.wikipedia.org/wiki/Windchill)
        feelsLike = 13.12 + 0.6215*temperature + Math.pow((0.3965 * temperature -11.37)*windspeed*3.6,0.16);
        feelsLike=Math.round(temperature*10)/10;
    }

    return feelsLike;
}


