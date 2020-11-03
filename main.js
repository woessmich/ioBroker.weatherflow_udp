//TODO: check if to add min/max values like min/max temperatures etc.

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

//Import constants with static interpretation data
const { devices } = require(__dirname + '/lib/messages')
const { messages } = require(__dirname + '/lib/messages')
const { windDirections } = require(__dirname + '/lib/messages')

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

        let that = this;

        //Clear previous m essage field on startup
        that.setStateAsync("lastMessage", "");
        
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

        await this.setObjectAsync("lastMessage", {
            type: "state",
            common: {
                name: "testVariable",
                type: "string",
                role: "indicator",
                read: true,
                write: true,
            },
            native: {},
        });

        mServer.on("listening", () => {
            const address = mServer.address();
            that.log.info(`adapter listening ${address.address}:${address.port}`);
        });

        //Receive UDP message
        mServer.on("message", (messageString, rinfo) => {

            var message;    //JSON parsed message
            
            //Set some Items to be ignored as they are parsed already and differently
            var ignoreItems = ["type", "serial_number", "hub_sn"];

            that.setStateAsync("lastMessage", messageString.toString("ascii"));
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

                if ("serial_number" in message) {

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

                        /*
                        that.getObject(message.hub_sn, (err, obj) => {
                            // catch error
                            if (err)
                                that.log.info(err);

                            // create node if non-existent
                            if (err || !obj) {
                                that.log.info(["Creating node: ", message.hub_sn].join(""));
                                that.setObject(message.hub_sn, {
                                    type: "device",
                                    common: {
                                        name: hubType + ": " + message.hub_sn,
                                    },
                                    native: {},
                                });
                            }
                        });
                        */

                        var deviceType = devices[message.serial_number.substring(0, 2)];         //Get type from first 2 characters of serial number

                        var serialParameters = {
                            type: "device",
                            common: {
                                name: deviceType + ": " + message.serial_number,
                            },
                            native: {},
                        };

                        that.myCreateState(message.hub_sn + "." + message.serial_number, serialParameters);  //create device

                        /*
                        that.getObject(message.hub_sn + "." + message.serial_number, (err, obj) => {
                            // catch error
                            if (err)
                                that.log.info(err);

                            // create node if non-existent
                            if (err || !obj) {
                                that.log.info("Creating node: " + message.hub_sn + "." + message.serial_number);
                                that.setObject(message.hub_sn + "." + message.serial_number, {
                                    type: "device",
                                    common: {
                                        name: deviceType + ": " + message.serial_number,
                                    },
                                    native: {},
                                });
                            }
                        });
                        */

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

                        /*
                        that.getObject(message.serial_number, (err, obj) => {
                            // catch error
                            if (err)
                                that.log.info(err);

                            // create node if non-existent
                            if (err || !obj) {
                                that.log.info("Creating node: " + message.serial_number);
                                that.setObject(message.serial_number, {
                                    type: "device",
                                    common: {
                                        name: deviceType + ": " + message.serial_number,
                                    },
                                    native: {},
                                });
                            }
                        });
                        */

                        //Set path to state
                        statePath = [message.serial_number, ".", message.type].join("");

                    }
                }


                if (that.config.debug)
                    that.log.info(["statepath: ", statePath].join(""));

                //Walk through items
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


                    //Check for unknown/new items
                    if ((item in messageInfo) == false && ignoreItems.includes(item) == false) {
                            that.log.warn(["Message ", messageType, " contains unknown parameter: ", item, " = ", itemvalue, ". Ignoring. Please check UDP message version and check with adapter developer."].join(''));
                    }

                    if (messageInfo[item] && ignoreItems.includes(item) == false) {      //only parse if part of "states" definition

                        //Walk through fields
                        Object.keys(itemvalue).forEach(function (field) {

                            if (!messageInfo[item][field]) {
                                that.log.warn(["Message contains unknown field '(", field, "' in message '", item, ")'. Check UDP message version and inform adapter developer."].join(''))
                                return 0;
                            }

                            var pathParameters = {
                                type: "device",
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

                            fieldvalue = ((fieldvalue == null) ? 0 : fieldvalue);  //replace null values with 0

                            if (that.config.debug)
                                that.log.info(["[", field, "] ", "state: ", stateName, " = ", fieldvalue].join(""));

                            /*
                            //Create state for message type
                            that.getObject(statePath, (err, obj) => {
                                // catch error
                                if (err)
                                    that.log.info(err);

                                // create node if non-existent
                                if (err || !obj) {
                                    that.log.debug('Creating node: ' + statePath);
                                    that.setObject(statePath, {
                                        type: "device",
                                        common: {
                                            name: messageInfo["name"],
                                        },
                                        native: {},
                                    });
                                }
                            });
                            */
                            that.myCreateState(statePath, pathParameters);  //create device
                            that.myCreateState(stateName, stateParameters, fieldvalue); //create node
                            
                            /*
                            that.getObject(stateName, (err, obj) => {
                                // catch error
                                if (err)
                                    that.log.info(err);

                                // create node if non-existent
                                if (err || !obj) {
                                    that.log.info('Creating node: ' + stateName);
                                    that.setObject(stateName, stateParameters);
                                }

                                //and always set value
                                that.setStateAsync(stateName, fieldvalue);
                            });
                            */

                            //Set connection state when message received and expire after 5 minutes of inactivity
                            that.setStateAsync("info.connection", { val: true, ack: true, expire: 600 });





                            //==============================
                            //Do special tasks based on data
                            //==============================

                            //Subscribe on certain state changes for min/max tracking
                            //Subscribe on states to easily calculate min/max values (they do not need to exist in the beginning)
                            that.subscribeStates(stateName);    //TODO: Is this needed?

                            //hourly rain accumulation of last 24h and sum of today and last day
                            if (messageInfo[item][field][0] == "precipAccumulated") {
                                var now = new Date();
                                var hourFrom = ("0" + now.getHours()).substr(-2);   //current full hour
                                var hourTo = ("0" + (now.getHours() + 1)).substr(-2);   //next full hour

                                //Check previous value of current hour and add to new if same hour
                                var stateNameHour = [statePath, "rainHistory", hourFrom + "-" + hourTo].join(".");  //current full hour until next full hour
                                var stateParametersHour = { type: "state", common: { type: "number", unit: "mm/h", read: true, write: false, role: "state", name: "Accumulated hourly rain; adapter calculated" }, native: {}, };

                                that.getState(stateNameHour, function (err, obj) {
                                    var fieldvalueHour_new = 0;
                                    if (obj) {  //if it exists
                                        var timestampHour = new Date(obj.ts);
                                        //Check if new value is from same hour as last value
                                        if (timestampHour.getHours() == now.getHours()) {   //only get old value and update if last timestamp is from same hour...
                                            fieldvalueHour_new = obj.val + fieldvalue;
                                        } else {
                                            fieldvalueHour_new = fieldvalue;                          //...otherwise: new hour => start at 0
                                        }
                                    }

                                    that.myCreateState(stateNameHour, stateParametersHour, fieldvalueHour_new);
/*
                                    //Write new value to state (or create first, if needed)
                                    that.getObject(stateNameHour, (err, obj) => {
                                        // catch error
                                        if (err)
                                            that.log.info(err);

                                        // create node if non-existent
                                        if (err || !obj) {
                                            that.log.info('Creating node: ' + stateNameHour);
                                            that.setObject(stateNameHour, stateParametersHour);
                                        }

                                        //and set value
                                        that.setStateAsync(stateNameHour, fieldvalueHour_new);
                                    });
                                    */
                                });

                                //Check if day has changed
                                var stateNameToday = [statePath, "rainHistory", "today"].join(".");
                                var stateParametersToday = { type: "state", common: { type: "number", unit: "mm/h", read: true, write: false, role: "state", name: "Accumulated rain today; adapter calculated" }, native: {}, };

                                //get previous value of current day and add new value if same day
                                that.getState(stateNameToday, function (err, obj) {
                                    var fieldvalueToday_old = 0;
                                    var fieldvalueToday_new = 0;
                                    if (obj) {  //if it exists
                                        var timestampToday = new Date(obj.ts);
                                        var fieldvalueToday_old = obj.val;

                                        //Check if new value is from same hour as last value
                                        if (timestampToday.getDay() != now.getDay()) {   //if day is different a new day started, so write yesterdays value to field and start over at 0                                         
                                            var stateNameYesterday = [statePath, "rainHistory", "yesterday"].join(".");
                                            var stateParametersYesterday = { type: "state", common: { type: "number", unit: "mm/h", read: true, write: false, role: "state", name: "Accumulated rain yesterday; adapter calculated" }, native: {}, };

                                            that.myCreateState(stateNameYesterday, stateParametersYesterday, fieldvalueToday_old);

                                            /*
                                            //Write new value to state (or create first, if needed)
                                            that.getObject(stateNameYesterday, (err, obj) => {
                                                // catch error
                                                if (err)
                                                    that.log.info(err);

                                                // create node if non-existent
                                                if (err || !obj) {
                                                    that.log.info('Creating node: ' + stateNameYesterday);
                                                    that.setObject(stateNameYesterday, stateParametersYesterday);
                                                }

                                                //and set value
                                                that.setStateAsync(stateNameYesterday, fieldvalueToday_old);
                                            });
                                            */

                                            fieldvalueToday_new = fieldvalue;   //discard old value for new todays's value if day has changed
                                        } else {
                                            fieldvalueToday_new = fieldvalueToday_old + fieldvalue;   //add new value to old if not a different day
                                        }

                                    }


                                    that.myCreateState(stateNameToday, stateParametersToday, fieldvalueToday_new);

                                    /*
                                    //Write new value to state (or create first, if needed)
                                    that.getObject(stateNameToday, (err, obj) => {
                                        // catch error
                                        if (err)
                                            that.log.info(err);

                                        // create node if non-existent
                                        if (err || !obj) {
                                            that.log.info('Creating node: ' + stateNameToday);
                                            that.setObject(stateNameToday, stateParametersToday);
                                        }

                                        //and set value
                                        that.setStateAsync(stateNameToday, fieldvalueToday_new);
                                    });
                                    */

                                });

                            }

                            //Reduced pressure (sea level) from station pressure
                            if (messageInfo[item][field][0] == "stationPressure") {
                                var airTemperature=15;  //standard value if not available
                                var relativeHumidity = 50; //standard value if not available
                                var height = 0;     //sea level if not available

                                var stateNameAirTemperature = [statePath, "airTemperature"].join(".");
                                var stateNameRelativeHumidity = [statePath, "relativeHumidity"].join(".");
                                var stateNameReducedPressure = [statePath, "reducedPressure"].join(".");
                                var stateParametersReducedPressure = { type: "state", common: { type: "number", unit: "hPa", read: true, write: false, role: "state", name: "Reduced pressure (sea level); adapter calculated" }, native: {}, };

                                that.getState(stateNameAirTemperature, function (err, obj) {
                                    if (obj) {  //if it exists
                                        airTemperature = obj.val;
                                    }

                                    that.getState(stateNameRelativeHumidity, function (err, obj) {
                                        if (obj) {  //if it exists
                                            relativeHumidity = obj.val;
                                        }

                                        var reducedPressure = getQFF(airTemperature, fieldvalue, that.config.height, relativeHumidity);

                                        that.myCreateState(stateNameReducedPressure, stateParametersReducedPressure, reducedPressure);
                                        /*
                                        //Write new value to state (or create first, if needed)
                                        that.getObject(stateNameReducedPressure, (err, obj) => {
                                            // catch error
                                            if (err)
                                                that.log.info(err);

                                            // create node if non-existent
                                            if (err || !obj) {
                                                that.log.info('Creating node: ' + stateNameReducedPressure);
                                                that.setObject(stateNameReducedPressure, stateParametersReducedPressure);
                                            }

                                            //and set value
                                            that.setStateAsync(stateNameReducedPressure, reducedPressure);
                                        });
                                        */

                                        if (that.config.debug)
                                            that.log.info(["Pressure conversion: ", "Station pressure: ", fieldvalue, ", Height: ", that.config.height, ", Temperature: ", airTemperature, ", Humidity: ", relativeHumidity, ", Reduced pressure: ", reducedPressure].join(''));

                                    });   
                                });
                            }

                            //Dewpoint from station temperature and humidity
                            //Is calculated and written when humidity is received (temperature comes before that) but might use previous value for temperature as asynchroneous update might take longer
                            if (messageInfo[item][field][0] == "relativeHumidity") {
                                var airTemperature;
                                var relativeHumidity;
                                var datavalidity=true;

                                var stateNameAirTemperature = [statePath, "airTemperature"].join(".");
                                var stateNameDewpoint = [statePath, "dewpoint"].join(".");
                                var stateParametersDewpoint = { type: "state", common: { type: "number", unit: "°C", read: true, write: false, role: "state", name: "Dewpoint; adapter calculated" }, native: {}, };

                                that.getState(stateNameAirTemperature, function (err, obj) {
                                    if (obj) {  //if it exists
                                        airTemperature = obj.val;
                                    } else {
                                        datavalidity = false;
                                    }

                                        if (datavalidity == true) {
                                            
                                            that.myCreateState(stateNameDewpoint, stateParametersDewpoint, fieldvalue);
                                            /*
                                            //Write new value to state (or create first, if needed)
                                            that.getObject(stateNameDewpoint, (err, obj) => {
                                                // catch error
                                                if (err)
                                                    that.log.info(err);

                                                // create node if non-existent
                                                if (err || !obj) {
                                                    that.log.info('Creating node: ' + stateNameDewpoint);
                                                    that.setObject(stateNameDewpoint, stateParametersDewpoint);
                                                }

                                                //and set value
                                                that.setStateAsync(stateNameDewpoint, dewpoint(airTemperature, fieldvalue));
                                            });
                                            */
                                        }

                                });
                            }

                            //Convert wind directions from degrees to cardinal directions                      
                            if (messageInfo[item][field][0] == "windDirection") {
                                var stateNameWindDirectionText = [statePath, "windDirectionCardinal"].join(".");
                                var stateParametersWindDirectionText = { type: "state", common: { type: "string", unit: "", read: true, write: false, role: "state", name: "Cardinal wind direction; adapter calculated" }, native: {}, };                                

                                
                                that.myCreateState(stateNameWindDirectionText, stateParametersWindDirectionText, windDirections[Math.round(fieldvalue / 22.5)]);
                                //TODO: Change everywhere to function
                                /*
                                //Write new value to state (or create first, if needed)
                                that.getObject(stateNameWindDirectionText, (err, obj) => {
                                    // catch error
                                    if (err)
                                        that.log.info(err);

                                    // create node if non-existent
                                    if (err || !obj) {
                                        that.log.info('Creating node: ' + stateNameWindDirectionText);
                                        that.setObject(stateNameWindDirectionText, stateParametersWindDirectionText);
                                    }

                                    //and set value
                                    that.setStateAsync(stateNameWindDirectionText, windDirections[Math.round(fieldvalue / 22.5)]);
                                });
                                */
                            }

                            //Convert wind speed from m/s to Beaufort                      
                            if (messageInfo[item][field][0] == "windSpeed" || messageInfo[item][field][0] == "windGust" || messageInfo[item][field][0] == "windLull") {
                                switch (messageInfo[item][field][0]) {
                                    case "windGust":
                                    var stateNameBeaufort = [statePath, "beaufortGust"].join(".");
                                    break;
                                    
                                    case "windLull":
                                    var stateNameBeaufort = [statePath, "beaufortLull"].join(".");
                                    break;

                                    default:
                                    var stateNameBeaufort = [statePath, "beaufort"].join(".");
                                }
                                
                                var stateParametersBeaufort = { type: "state", common: { type: "number", unit: "", read: true, write: false, role: "state", name: "Wind speed in Beaufort; adapter calculated" }, native: {}, };

                                //Write new value to state (or create first, if needed)
                            that.getObject(stateNameBeaufort, (err, obj) => {
                                    // catch error
                                    if (err)
                                        that.log.info(err);

                                    // create node if non-existent
                                    if (err || !obj) {
                                        that.log.info('Creating node: ' + stateNameBeaufort);
                                        that.setObject(stateNameBeaufort, stateParametersBeaufort);
                                    }

                                    //and set value
                                    that.setStateAsync(stateNameBeaufort, beaufort(fieldvalue));
                                });
                            }

                            //Calculate minimums
                            //const minItems=["airTemperature","reducedPressure"];

                            //Calculate maximums
                            //const maxItems=[];

                            //==============================
                            //End of special tasks section
                            //==============================


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
            socket.close();     //close UDP port
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
    myCreateState(stateName,stateParameters,stateValue = null) {  
        this.getObject(stateName, (err, obj) => {
            // catch error
            if (err)
                this.log.info(err);

            // create node if non-existent
            if (err || !obj) {
                this.log.info('Creating node: ' + stateName);
                this.setObject(stateName, stateParameters);
            }

            //and set value if available
            if (stateValue!=null) {
                this.setStateAsync(stateName, stateValue);
            }
        });
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
 * @param {float} windspeed The local air temperature in °C
 * @returns {float}
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


