
/*
WeatherFlow Smart Weather UDP Reference - v143
https://weatherflow.github.io/SmartWeather/api/udp/v143/
*/

const { ENETDOWN } = require("constants");

const messages=[];

messages["evt_precip"] = {
    "name": "Rain Start Event",
    "evt":
    {
        "0": ["timestamp", { type: "state", common: { type: "number", read: true, write: false, role: "date", name: "Time of event" }, native: {}, }],
    }
};

messages["evt_strike"] = {
    "name": "Lightning Strike Event",
    "evt":
    {
        "0": ["timestamp", { type: "state", common: { type: "number", read: true, write: false, role: "date", name: "Time of event" }, native: {}, }],
        "1": ["distance", {type: "state",common: {type: "number", unit: "km", read: true, write: false, role: "state", name: "Strike distance"},native:{}, }],
        "2": ["energy", { type: "state", common: { type: "number", unit: "", read: true, write: false, role: "state", name: "Strike energy" }, native: {}, }],
    },
};

messages["rapid_wind"] = {
    "name": "Rapid Wind",
"ob":
    {
        "0": ["timestamp", { type: "state", common: { type: "number", read: true, write: false, role: "date", name: "Time of event" }, native: {}, }],
        "1": ["windSpeed", { type: "state", common: { type: "number", unit: "m/s", read: true, write: false, role: "state", name: "Wind speed" }, native: {}, }],
        "2": ["windDirection", { type: "state", common: { type: "number", unit: "°", read: true, write: false, role: "state", name: "Wind direction" }, native: {}, }],
    }
};

messages["obs_air"] = {
    "name": "Observation (AIR)",
    "obs":
    {
        "0": ["timestamp", { type: "state", common: { type: "number", read: true, write: false, role: "date", name: "Time of event" }, native: {}, }],
        "1": ["stationPressure", { type: "state", common: { type: "number", unit: "hPa", read: true, write: false, role: "state", name: "Station pressure (raw)" }, native: {}, }],
        "2": ["airTemperature", { type: "state", common: { type: "number", unit: "°C", read: true, write: false, role: "state", name: "Air Temperature" }, native: {}, }],
        "3": ["relativeHumidity", { type: "state", common: { type: "number", unit: "%", read: true, write: false, role: "state", name: "Relative Humidity" }, native: {}, }],
        "4": ["lightningStrikeCount", { type: "state", common: { type: "number", unit: "", read: true, write: false, role: "state", name: "Lightning Strike Count" }, native: {}, }],
        "5": ["lightningStrikeAvgDistance", { type: "state", common: { type: "number", unit: "km", read: true, write: false, role: "state", name: "Lightning Strike Avg Distance" }, native: {}, }],
        "6": ["battery", { type: "state", common: { type: "number", unit: "V", read: true, write: false, role: "state", name: "Battery" }, native: {}, }],
        "7": ["reportInterval", { type: "state", common: { type: "number", unit: "min", read: true, write: false, role: "state", name: "Report Interval" }, native: {}, }],
    },
    "firmware_revision":
    {
        "0": ["firmware_revision", { type: "state", common: { type: "number", unit: "", read: true, write: false, role: "state", name: "Firmware revision" }, native: {}, }],
    }
};

messages["obs_sky"] = {
    "name": "Observation (Sky)",
    "obs":
    {
        "0": ["timestamp", { type: "state", common: { type: "number", read: true, write: false, role: "date", name: "Time of event" }, native: {}, }],
        "1": ["illuminance", { type: "state", common: { type: "number", unit: "Lux", read: true, write: false, role: "state", name: "Illuminance" }, native: {}, }],
        "2": ["UV", { type: "state", common: { type: "number", unit: "", read: true, write: false, role: "state", name: "UV Index" }, native: {}, }],
        "3": ["rainAccumulated", { type: "state", common: { type: "number", unit: "mm", read: true, write: false, role: "state", name: "Rain Accumulated" }, native: {}, }],
        "4": ["windLull", { type: "state", common: { type: "number", unit: "m/s", read: true, write: false, role: "state", name: "Wind Lull (minimum 3 second sample)" }, native: {}, }],
        "5": ["windAvg", { type: "state", common: { type: "number", unit: "m/s", read: true, write: false, role: "state", name: "Wind Avg (average over report interval)" }, native: {}, }],
        "6": ["windGust", { type: "state", common: { type: "number", unit: "m/s", read: true, write: false, role: "state", name: "Wind Gust (maximum 3 second sample)" }, native: {}, }],
        "7": ["windDirection", { type: "state", common: { type: "number", unit: "°", read: true, write: false, role: "state", name: "Wind Direction" }, native: {}, }],
        "8": ["battery", { type: "state", common: { type: "number", unit: "V", read: true, write: false, role: "state", name: "Battery" }, native: {}, }],
        "9": ["reportInterval", { type: "state", common: { type: "number", unit: "min", read: true, write: false, role: "state", name: "Report Interval" }, native: {}, }],
        "10": ["solarRadiation", { type: "state", common: { type: "number", unit: "W/m^2", read: true, write: false, role: "state", name: "Solar Radiation" }, native: {}, }],
        "11": ["localDayRainAccumulation", { type: "state", common: { type: "number", unit: "mm", read: true, write: false, role: "state", name: "Local Day Rain Accumulation" }, native: {}, }],
        "12": ["precipitationType", { type: "state", common: { type: "mixed", states: { 0: "None", 1: "Rain", 2: "Hail", 3: "Rain/Hail" }, unit: "", read: true, write: false, role: "state", name: "Precipitation Type" }, native: {}, }],
        "13": ["windSampleInterval", { type: "state", common: { type: "number", unit: " s", read: true, write: false, role: "state", name: "Wind Sample Interval" }, native: {}, }],
    },
    "firmware_revision":
    {
        "0": ["firmware_revision", { type: "state", common: { type: "number", unit: "", read: true, write: false, role: "state", name: "Firmware revision" }, native: {}, }],
    }
};
    
messages["obs_st"] = {
    "name": "Observation (Tempest)",
    "obs":
    {
        "0": ["timestamp", { type: "state", common: { type: "number", read: true, write: false, role: "date", name: "Time of event" }, native: {}, }],
        "1": ["windLull", { type: "state", common: { type: "number", unit: "m/s", read: true, write: false, role: "state", name: "Wind Lull (minimum 3 second sample)" }, native: {}, }],
        "2": ["windAvg", { type: "state", common: { type: "number", unit: "m/s", read: true, write: false, role: "state", name: "Wind Avg (average over report interval)" }, native: {}, }],
        "3": ["windGust", { type: "state", common: { type: "number", unit: "m/s", read: true, write: false, role: "state", name: "Wind Gust (maximum 3 second sample)" }, native: {}, }],
        "4": ["windDirection", { type: "state", common: { type: "number", unit: "°", read: true, write: false, role: "state", name: "Wind Direction" }, native: {}, }],
        "5": ["windSampleInterval", { type: "state", common: { type: "number", unit: "s", read: true, write: false, role: "state", name: "Wind Sample Interval" }, native: {}, }],
        "6": ["stationPressure", { type: "state", common: { type: "number", unit: "hPa", read: true, write: false, role: "state", name: "Station pressure (raw)" }, native: {}, }],
        "7": ["airTemperature", { type: "state", common: { type: "number", unit: "°C", read: true, write: false, role: "state", name: "Air Temperature" }, native: {}, }],
        "8": ["relativeHumidity", { type: "state", common: { type: "number", unit: "%", read: true, write: false, role: "state", name: "Relative Humidity" }, native: {}, }],
        "9": ["illuminance", { type: "state", common: { type: "number", unit: "Lux", read: true, write: false, role: "state", name: "Illuminance" }, native: {}, }],
        "10": ["UV", { type: "state", common: { type: "number", unit: "", read: true, write: false, role: "state", name: "UV Index" }, native: {}, }],
        "11": ["solarRadiation", { type: "state", common: { type: "number", unit: "W/m^2", read: true, write: false, role: "state", name: "Solar Radiation" }, native: {}, }],
        "12": ["precipAccumulated", { type: "state", common: { type: "number", unit: "mm", read: true, write: false, role: "state", name: "Precipitation Accumulated" }, native: {}, }],
        "13": ["precipitationType", { type: "state", common: { type: "mixed", states: { 0: "None", 1: "Rain", 2: "Hail", 3: "Rain/Hail" }, unit: "", read: true, write: false, role: "state", name: "Precipitation Type" }, native: {}, }],
        "14": ["lightningStrikeAvgDistance", { type: "state", common: { type: "number", unit: "km", read: true, write: false, role: "state", name: "Lightning Strike Avg Distance" }, native: {}, }],
        "15": ["lightningStrikeCount", { type: "state", common: { type: "number", unit: "", read: true, write: false, role: "state", name: "Lightning Strike Count" }, native: {}, }],
        "16": ["battery", { type: "state", common: { type: "number", unit: "V", read: true, write: false, role: "state", name: "Battery" }, native: {}, }],
        "17": ["reportInterval", { type: "state", common: { type: "number", unit: "min", read: true, write: false, role: "state", name: "Report Interval" }, native: {}, }],
    },
    "firmware_revision":
    {
        "0": ["firmware_revision", { type: "state", common: { type: "number", unit: "", read: true, write: false, role: "state", name: "Firmware revision" }, native: {}, }],
    }
};

messages["device_status"] = {
    "name": "Status (device)",
    "timestamp": {
        "0": ["timestamp", { type: "state", common: { type: "number", read: true, write: false, role: "date", name: "Time of event" }, native: {}, }],
    },
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
    "sensor_status": {  //0x00000000	All	Sensors OK, 0x00000001	lightning failed, 0x00000002	lightning noise, 0x00000004	lightning disturber, 0x00000008	pressure failed, 0x00000010	temperature failed, 0x00000020	rh failed, 0x00000040	wind failed, 0x00000080	precip failed, 0x00000100light/uv failed 
        "0": ["sensor_status", { type: "state", common: { type: "number", unit: "", read: true, write: false, role: "state", name: "Sensor status" }, native: {}, }],
    },
    "debug": { 
        "0": ["debug", { type: "state", common: { type: "number", unit:"", read: true, write: false, role: "state", name: "Debug" }, native: {}, }],
    },

};
    
messages["hub_status"] = {
    "name":"Status (hub)",
    "firmware_revision":
    {
        "0": ["firmware_revision", { type: "state", common: { type: "string", unit: "", read: true, write: false, role: "state", name: "Firmware revision" }, native: {}, }],
    },
    "uptime": {
        "0": ["uptime", { type: "state", common: { type: "number", unit: "s", read: true, write: false, role: "state", name: "Uptime" }, native: {}, }],
    },
    "rssi": {
        "0": ["rssi", { type: "state", common: { type: "number", unit: "", read: true, write: false, role: "state", name: "RSSI value" }, native: {}, }],
    },
    "timestamp": {
        "0": ["timestamp", { type: "state", common: { type: "number", read: true, write: false, role: "date", name: "Time of event" }, native: {}, }],
    },
    "reset_flags": {
        "0": ["reset_flags", { type: "state", common: { type: "string", read: true, write: false, role: "state", name: "Reset flags" }, native: {}, /*BOR	Brownout reset, PIN	PIN reset, POR	Power reset, SFT	Software reset, WDG	Watchdog reset, WWD	Window watchdog reset, LPW	Low-power reset*/ }],
    },
    "seq": {
        "0": ["seq", { type: "state", common: { type: "number", read: true, write: false, role: "state", name: "Seq" }, native: {}, }],
    },
    "fs": {
        "0": ["fs.internal_1", { type: "state", common: { type: "number", unit: "", read: true, write: false, role: "state", name: "internal 1" }, native: {}, }],
        "1": ["fs.internal_2", { type: "state", common: { type: "number", unit: "", read: true, write: false, role: "state", name: "internal 2" }, native: {}, }],
        "2": ["fs.internal_3", { type: "state", common: { type: "number", unit: "", read: true, write: false, role: "state", name: "internal 3" }, native: {}, }],
        "3": ["fs.internal_4", { type: "state", common: { type: "number", unit: "", read: true, write: false, role: "state", name: "internal 4" }, native: {}, }],
    },
    "radio_stats": {
        "0": ["radio_stats.version", { type: "state", common: { type: "number", unit: "", read: true, write: false, role: "state", name: "Version" }, native: {}, }],
        "1": ["radio_stats.rebootCount", { type: "state", common: { type: "number", unit: "", read: true, write: false, role: "state", name: "Reboot Count" }, native: {}, }],
        "2": ["radio_stats.I2CBusErrorCount", { type: "state", common: { type: "number", unit: "", read: true, write: false, role: "state", name: "I2C Bus Error Count" }, native: {}, }],
        "3": ["radio_stats.radioStatus", { type: "state", common: { type: "mixed", states: { 0: "Radio Off", 1: "Radio On", 3: "Radio Active" }, read: true, write: false, role: "state", name: "Radio Status" }, native: {}, }],
        "4": ["radio_stats.radioNetworkID", { type: "state", common: { type: "number", unit :"", read: true, write: false, role: "state", name: "Radio Network ID" }, native: {}, }],
    },
    "mqtt_stats": {
        "0": ["mqtt_stats.internal_1", { type: "state", common: { type: "number", unit: "", read: true, write: false, role: "state", name: "internal 1" }, native: {}, }],
        "1": ["mqtt_stats.internal_2", { type: "state", common: { type: "number", unit: "", read: true, write: false, role: "state", name: "internal 2" }, native: {}, }],
    },
};


//Device type by first two characters of serial number
const devices = {
    "HB" : "Hub",
    "AR" : "Air",
    "SK" : "Sky",
    "ST" : "Tempest",
}

const sensorfails = {
    0b000000001 : "Lightning failed",
    0b000000010 : "Lightning noise",
    0b000000100 : "Lightning disturber",
    0b000001000 : "Pressure failed",
    0b000010000 : "Temperature failed",
    0b000100000 : "Humidity failed",
    0b001000000 : "Wind failed",
    0b010000000 : "Precipitation failed",
    0b100000000 : "Light/uv failed",
}

//Wind directions in letters
const windDirections = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW","N"];

const minCalcs = ["airTemperature", "stationPressure", "relativeHumidity", "lightningStrikeAvgDistance", "distance",];
const maxCalcs = ["airTemperature", "windLull", "windGust", "windAvg", "windSpeed", "illuminance", "UV", "solarRadiation", "stationPressure", "relativeHumidity", "lightningStrikeCount", "energy"];

module.exports = { messages, devices, windDirections, minCalcs, maxCalcs,sensorfails};

