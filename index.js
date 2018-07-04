/* jshint node: true */
"use strict";
var Service;
var Characteristic;
var DoorState;
var process = require('process');
var mqtt = require('mqtt');
        
var GarageDoorPosition = {
  Closed: 0,
  Closing: 1,
  Opening: 2,
  Open: 3,
  Stopped: 4
};

var GarageDoorTargetState = {
  Closed: 0,
  Open: 1
};

module.exports = function(homebridge) {
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  DoorState = homebridge.hap.Characteristic.CurrentDoorState;

  homebridge.registerAccessory("homebridge-rasppi-gpio-garagedoor", "RaspPiGPIOGarageDoor", RaspPiGPIOGarageDoorAccessory);
};

function getVal(config, key, defaultVal) {
    var val = config[key];
    if (val === null) {
        return defaultVal;
    }
    return val;
}

function RaspPiGPIOGarageDoorAccessory(log, config) {
  this.log = log;
  this.version = require('./package.json').version;
  log("RaspPiGPIOGarageDoorAccessory version " + this.version);

  if (process.geteuid() !== 0) {
    log("WARN! WARN! WARN! may not be able to control GPIO pins because not running as root!");
  }

  this.name = config.name;

  this.initService();
  this.position = GarageDoorPosition.Closed;
}

RaspPiGPIOGarageDoorAccessory.prototype = {

  doorStateToString: function(state) {
    switch (state) {
      case DoorState.OPEN:
        return "OPEN";
      case DoorState.CLOSED:
        return "CLOSED";
      case DoorState.STOPPED:
        return "STOPPED";
      default:
        return "UNKNOWN";
    }
  },

  hasOpenSensor : function() {
    return this.openDoorSensorPin !== null;
  },

  hasClosedSensor : function() {
    return this.closedDoorSensorPin !== null;
  },

  initService: function() {
    this.garageDoorOpener = new Service.GarageDoorOpener(this.name,this.name);
    this.currentDoorState = this.garageDoorOpener.getCharacteristic(DoorState);
    this.currentDoorState.on('get', this.getState.bind(this));
    this.targetDoorState = this.garageDoorOpener.getCharacteristic(Characteristic.TargetDoorState);
    this.targetDoorState.on('set', this.setState.bind(this));
    this.targetDoorState.on('get', this.getTargetState.bind(this));

    this.infoService = new Service.AccessoryInformation();
    this.infoService
      .setCharacteristic(Characteristic.Manufacturer, "Opensource Community")
      .setCharacteristic(Characteristic.Model, "RaspPi GPIO GarageDoor")
      .setCharacteristic(Characteristic.SerialNumber, "Version 1.0.0");
  
    this.log("Initial Door State: " + this.position);
    this.currentDoorState.updateValue(DoorState.CLOSED);
    this.targetDoorState.updateValue(DoorState.CLOSED);

    var client = mqtt.connect("mqtt://localhost:1883/");
    this.client = client;

    client.on('connect', function() {
      client.subscribe("garage_door/state_changed");
    });


    client.on('message', function(topic, message) {
      if (topic == "garage_door/state_changed") {
        this.position = message[0];
        this.currentDoorState.updateValue(this._getStateFromPosition());
      }
      console.log('got message ' + message + ' on topic ' + topic);
    });
  },

  _getStateFromPosition: function() {
    var state;
    switch (this.position) {
      case GarageDoorPosition.Open:
        state = DoorState.OPEN;
        break;
      case GarageDoorPosition.Closed:
        state = DoorState.CLOSED;
        break;
      case GarageDoorPosition.Stopped:
        state = DoorState.STOPPED;
        break;
      case GarageDoorPosition.Opening:
        state = DoorState.OPENING;
        break;
      case GarageDoorPosition.Closing:
        state = DoorState.CLOSING;
        break;
      default:
        this.log("ERROR: invalid position " + this.position); 
        state = DoorState.STOPPED;
        break;
    }
    return state;
  },

  getTargetState: function(callback) {
    callback(null, this._getStateFromPosition());
  },

  triggerDoor: function(state) {
    this.client.publish("garage_door/set_target_state", state == DoorState.OPEN ? GarageDoorTargetState.Open : GarageDoorTargetState.Closed);
  },

  // TODO: track if we don't hear back in a certain amount of time

  setState: function(state, callback) {
    this.log("Setting state to " + state);
    this.targetState = state;
    var isClosed = this.isClosed();
    if ((state == DoorState.OPEN && isClosed) || (state == DoorState.CLOSED && !isClosed)) {
      this.log("Triggering GarageDoor");
      setTimeout(this.setFinalDoorState.bind(this), this.doorOpensInSeconds * 1000);
      this.triggerDoor(state);
    }

    callback();
    return true;
  },

  getState: function(callback) {
    callback(null, this._getStateFromPosition());
  },

  getServices: function() {
    return [this.infoService, this.garageDoorOpener];
  }
};
