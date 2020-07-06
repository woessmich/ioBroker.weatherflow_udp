//TODO: hourly rain
//TODO: daily rain
//TODO: add about min/max values like min/max temperatures etc.

"use strict";

/*
 * Created with @iobroker/create-adapter v1.25.0
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const utils = require("@iobroker/adapter-core");

// Load your modules here, e.g.:
const dgram = require("dgram");
let mServer = null;

var getMessageInfo = require(__dirname + "/lib/messages").getMessageInfo;
var getDeviceType = require(__dirname + "/lib/messages").getDeviceType;

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

        mServer.on("error", err => {
            that.log.error(`Cannot open socket:\n${err.stack}`);
            mServer.close();
            process.exit(20);
        });

        //Attach to UDP Port
        mServer.bind(this.config.UDP_port);

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
            that.setStateAsync("lastMessage", message.toString("ascii"));
            if (that.config.debug)
                that.log.debug(rinfo.address + ":" + rinfo.port + " - " + message.toString("ascii"));
            

            //let that = this;

            try {
                message = JSON.parse(message);
            }
            catch (e) {
                // Anweisungen für jeden Fehler
                that.log.warn(["Non-JSON message received: '",message,"'. Ignoring."].join(""));
                return 0
            }

            if ("type" in message == false) {
                that.log.warn(["Non- or unknown weatherflow message received: '",message,"'. Ignoring."].join("")); 
                return 0
            }

            var messageType = message.type;  //e.g. "rapid_wind"

            if (that.config.debug)
                that.log.info(["Message type: '", message.type,"'"].join(""));

            var messageInfo = getMessageInfo(messageType);

            if (that.config.debug)
                that.log.info(["messageInfo: ", JSON.stringify(messageInfo)].join(''));
            
            var statepath;  //name of current state to set or create

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
                            that.log.info(["Creating node: ",message.hub_sn].join(""));
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

                    that.getObject(message.hub_sn+"."+message.serial_number, (err, obj) => {
                        // catch error
                        if (err)
                            that.log.info(err);

                        // create node if non-existent
                        if (err || !obj) {
                            that.log.info("Creating node: " + message.hub_sn + "." + message.serial_number);
                            that.setObject(message.hub_sn+"."+message.serial_number, {
                                type: "device",
                                common: {
                                    name: deviceType+": " + message.serial_number,
                                },
                                native: {},
                            });
                        } 
                    });

                    //Set complete path to state hub and serial
                    statepath = [message.hub_sn, ".", message.serial_number, ".", message.type].join("");

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
                    statepath = [message.serial_number, ".", message.type].join("");

                }
            }
            

            if (that.config.debug)
                that.log.info(["statepath: ", statepath].join(""));

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

                
                //Set some Items to be ignored as they are parsed already and differently
                var ignoreItems = ["type","serial_number","hub_sn"];

                if (messageInfo[item]) {      //only parse if part of "states" definition
                    

                    
                        //Walk through fields
                    Object.keys(itemvalue).forEach(function (value) {

                        if (!messageInfo[item][value]) {
                            that.log.warn(["Message contains unknown parameter: (",value," in ",item,"). Check UDP message version and inform adapter developer."].join(''))
                            return 0;
                        }

                        var stateParameters = messageInfo[item][value][1];
                        var statename = [statepath, messageInfo[item][value][0]].join('.');
                        var statevalue = itemvalue[value];

                        if (messageInfo[item][value][0] == 'timestamp') { //timestamp in iobroker is milliseconds and date
                            statevalue = new Date(statevalue * 1000);
                        }

                        statevalue = ((statevalue == null) ? 0 : statevalue);  //replace null values with 0

                        if (that.config.debug)
                            that.log.info(["[",value,"] ","state: ",statename, " = ", statevalue].join(""));
                       
                        //Create state for message type
                        that.getObject(statepath, (err, obj) => {
                            // catch error
                            if (err)
                                that.log.info(err);

                            // create node if non-existent
                            if (err || !obj) {
                                that.log.debug('Creating node: ' + statepath);
                                that.setObject(statepath, {
                                    type: "device",
                                    common: {
                                        name: messageInfo["name"],
                                    },
                                    native: {},
                                });
                            }
                        });


                        that.getObject(statename, (err, obj) => {
                            // catch error
                            if (err)
                                that.log.info(err);
                            
                                // create node if non-existent
                            if (err || !obj) {
                                that.log.info('Creating node: ' + statename);
                                that.setObject(statename, stateParameters);
                            }

                            //and always set value
                            that.setStateAsync(statename, statevalue);
                        });

                        //Set connection state when message received and expire after 5 minutes of inactivity
                        that.setStateAsync("info.connection", { val: true, ack: true, expire: 600 }); 

                    });
                } else if (!item in ignoreItems) {
                    that.log.warn(["Message ",messageType," contains unknown parameter: ",item,". Please check UDP message version and check with adapter developer."].join(''));
                }

            });

        });


    }


    /**
     * Is called when adapter shuts down - callback has to be called under any circumstances!
     * @param {() => void} callback
     */
    onUnload(callback) {
        try {
            socket.close();
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