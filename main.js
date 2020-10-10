//TODO: daily rain
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

var getMessageInfo = require(__dirname + "/lib/messages").getMessageInfo;
var getDeviceType = require(__dirname + "/lib/messages").getDeviceType;

const messages = [];
messages["device_status"] = {
    "name": "Status (device)",

    "uptime":
    {
        "0": ["uptime", { type: "state", common: { type: "number", unit: "s", read: true, write: false, role: "state", name: "Uptime" }, native: {}, }],
    },
    "voltage": {
        "0": ["voltage", { type: "state", common: { type: "number", unit: " V", read: true, write: false, role: "state", name: "Voltage" }, native: {}, }],
    },
    "firmware_revision": {
        "0": ["firmware_revision", { type: "state", common: { type: "number", unit: "", read: true, write: false, role: "state", name: "Firmware revision" }, native: {}, }],
    },
    "rssi": {
        "0": ["rssi", { type: "state", common: { type: "number", unit: "", read: true, write: false, role: "state", name: "RSSI value" }, native: {}, }],
    },
    "hub_rssi": {
        "0": ["hub_rssi", { type: "state", common: { type: "number", unit: "", read: true, write: false, role: "state", name: "Hub RSSI value" }, native: {}, }],
    },
    "sensor_status": {  //0x00000000	All	Sensors OK, 0x00000001	AIR	lightning failed, 0x00000002	AIR	lightning noise, 0x00000004	AIR	lightning disturber, 0x00000008	AIR	pressure failed, 0x00000010	AIR	temperature failed, 0x00000020	AIR	rh failed, 0x00000040	SKY	wind failed, 0x00000080	SKY	precip failed, 0x00000100	SKY	light/uv failed 
        "0": ["sensor_status", { type: "state", common: { type: "number", unit: "", read: true, write: false, role: "state", name: "Sensor Status" }, native: {}, }],
    },
    "debug": {
        "0": ["debug", { type: "state", common: { type: "number", unit: "", read: true, write: false, role: "state", name: "Debug" }, native: {}, }],
    },

};





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
    }

    /**
     * Is called when databases are connected and adapter received configuration.
     */
    async onReady() {
        // Initialize your adapter here

        let that = this;

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
        mServer.on("message", (message, rinfo) => {

            //Set some Items to be ignored as they are parsed already and differently
            var ignoreItems = ["type", "serial_number", "hub_sn"];

            that.setStateAsync("lastMessage", message.toString("ascii"));
            if (that.config.debug)
                that.log.debug(rinfo.address + ":" + rinfo.port + " - " + message.toString("ascii"));

            try {
                message = JSON.parse(message);
            }
            catch (e) {
                // Anweisungen für jeden Fehler
                that.log.warn(["Non-JSON message received: '", message, "'. Ignoring."].join(""));
                return 0
            }

            if ("type" in message == false) {
                that.log.warn(["Non- or unknown weatherflow message received: '", message, "'. Ignoring."].join(""));
                return 0
            }

            var messageType = message.type;  //e.g. "rapid_wind"

            if (that.config.debug)
                that.log.info(["Message type: '", message.type, "'"].join(""));

            var messageInfo = getMessageInfo(messageType);

            if (that.config.debug)
                that.log.info(["messageInfo: ", JSON.stringify(messageInfo)].join(''));

            var statePath;  //name of current state to set or create

            if (messageInfo == false) {
                if (that.config.debug)
                    that.log.info(["Unknown message type: ", messageType, " - ignoring"].join(''));
            } else {
                if (that.config.debug)
                    that.log.info(["messageInfo: ", JSON.stringify(messageInfo)].join(''));

                if ("serial_number" in message) {

                    if ('hub_sn' in message) { //device message with serial and hub serial

                        //Create state for hub
                        var hubType = getDeviceType(message.hub_sn.substring(0, 2));     //Get type from first 2 characters of serial number

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

                        var deviceType = getDeviceType(message.serial_number.substring(0, 2));     //Get type from first 2 characters of serial number

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

                        //Set complete path to state hub and serial
                        statePath = [message.hub_sn, ".", message.serial_number, ".", message.type].join("");

                    } else {    //device message without hub serial (probably only hub)

                        var deviceType = getDeviceType(message.serial_number.substring(0, 2));     //Get type from first 2 characters of serial number

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

                            var stateParameters = messageInfo[item][field][1];
                            var stateName = [statePath, messageInfo[item][field][0]].join('.');
                            var fieldvalue = itemvalue[field];

                            if (messageInfo[item][field][0] == 'timestamp') { //timestamp in iobroker is milliseconds and date
                                fieldvalue = new Date(fieldvalue * 1000);
                            }

                            fieldvalue = ((fieldvalue == null) ? 0 : fieldvalue);  //replace null values with 0

                            if (that.config.debug)
                                that.log.info(["[", field, "] ", "state: ", stateName, " = ", fieldvalue].join(""));

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

                            //Set connection state when message received and expire after 5 minutes of inactivity
                            that.setStateAsync("info.connection", { val: true, ack: true, expire: 600 });

                            //Do special tasks based on data
                            //==============================

                            //hourly rain accumulation of last 24h and sum of today and last day
                            if (messageInfo[item][field][0] == "precipAccumulated") {
                                var now = new Date();
                                var hourFrom = ("0" + now.getHours()).substr(-2);   //current full hour
                                var hourTo = ("0" + (now.getHours() + 1)).substr(-2);   //next full hour

                                //Check previous value of current hour and add to new if same hour
                                var stateNameHour = [statePath, "rainHistory", hourFrom + "-" + hourTo].join(".");  //current full hour until next full hour
                                var stateParametersHour = { type: "state", common: { type: "number", unit: "mm/h", read: true, write: false, role: "state", name: "Accumulated hourly rain" }, native: {}, };

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
                                });

                                //Check if day has changed
                                var stateNameToday = [statePath, "rainHistory", "today"].join(".");
                                var stateParametersToday = { type: "state", common: { type: "number", unit: "mm/h", read: true, write: false, role: "state", name: "Accumulated rain today" }, native: {}, };

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
                                            var stateParametersYesterday = { type: "state", common: { type: "number", unit: "mm/h", read: true, write: false, role: "state", name: "Accumulated rain yesterday" }, native: {}, };

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

                                            fieldvalueToday_new = fieldvalue;   //discard old value for new todays's value if day has changed
                                        } else {
                                            fieldvalueToday_new = fieldvalueToday_old + fieldvalue;   //add new value to old if not a different day
                                        }

                                    }



                                    //Write new value to state (or create first, if needed)
                                    that.getObject(stateName, (err, obj) => {
                                        // catch error
                                        if (err)
                                            that.log.info(err);

                                        // create node if non-existent
                                        if (err || !obj) {
                                            that.log.info('Creating node: ' + stateName);
                                            that.setObject(stateNameToday, stateParametersToday);
                                        }

                                        //and set value
                                        that.setStateAsync(stateNameToday, fieldvalueToday_new);
                                    });

                                });

                            }


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