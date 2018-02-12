/**
 * @constructor
 */
function PushMidi(socket, $scope) {
	
	var midiAccess, pushOutput;
	var dialLine = ["","","","","","","",""];
	var toggleLine = ["","","","","","","",""];
	var controlMaps = {
		71:{name:"mem", call:$scope.changeMaxNumFragments, init:200, min:10, max:1000, incr:10},
		72:{name:"clu", call:$scope.changeClusterProportion, init:0.1, min:0.05, max:0.5, incr:0.05},
		73:{name:"lis", call:$scope.changeListeningThreshold, init:0.5, min:0, max:1, incr:0.1},
		74:{name:"rec", call:$scope.changeRecordingLength, init:10, min:2, max:10, incr:1},
		//74:{name:"seg", call:$scope.changeSegmentLength, init:5, min:1, max:10, incr:1},
		75:{name:"fad", call:$scope.changeFadeLength, init:0.5, min:0.1, max:2.5, incr:0.1},
		76:{name:"eff", call:$scope.changeEffectsAmount, init:0.3, min:0.01, max:2, incr:0.01},
		77:{name:"gai", call:$scope.changeGain, init:1, min:0.1, max:2, incr:0.01},
		78:{name:"pug", call:$scope.setSamplerGain, init:0.3, min:0.1, max:2, incr:0.01}
	};
	var toggleMaps = {
		20:{name:"rec", call:$scope.toggleRecording},
		21:{name:"play", call:$scope.togglePlaying},
		22:{name:"auto", call:$scope.toggleAutoPlay},
		23:{name:"clear", call:$scope.clearMemory},
	};
	var currentControlValues = {};
	
	if (navigator.requestMIDIAccess) {
		navigator.requestMIDIAccess({sysex:true}).then(function(access) {
			midiAccess = access;
			init();
		});
	} else {
		console.log('No Web MIDI support');
	}
	
	function init() {
		var iter = midiAccess.outputs.values();
		for (var i = iter.next(); i && !i.done; i = iter.next()) {
			if (i.value.name == 'Ableton Push User Port') {
				pushOutput = i.value;
			}
		}
		midiAccess.inputs.forEach(function(entry) {entry.onmidimessage = onMIDIMessage;});
		reset();
	}
	
	function reset() {
		for (var i = 36; i < 100; i++) {
			setPadLight(i);
		}
		for (var i = 0; i < 4; i++) {
			clearDisplayLine(i);
		}
		for (var num in controlMaps) {
			currentControlValues[num] = controlMaps[num].init;
			setParam(num, currentControlValues[num]);
		}
		for (var num in toggleMaps) {
			setToggleStatus(num-20, toggleMaps[num].name);
			setToggleLight(num, false);
		}
	}
	
	function onMIDIMessage(event) {
		var str = "MIDI message received at timestamp " + event.timestamp + "[" + event.data.length + " bytes]: ";
		for (var i=0; i<event.data.length; i++) {
			str += "0x" + event.data[i].toString(16) + " ";
		}
		//console.log(str, event.data);
		
		if (36 <= event.data[1] && event.data[1] <= 99) {
			var index = event.data[1]-36;
			var amplitude = 1.0/128*event.data[2];
			if (event.data[0] == 0x90) { //note on
				$scope.startSample(index, amplitude);
			} else if (event.data[0] == 0x80) { //note off
				$scope.stopSample(index);
			} else if (event.data[0] == 0xa0) { //after touch
				$scope.bendEnvelope(index, amplitude);
			}
		}
		if (event.data[0] == 0xe0) { //pitch bend
			var bend = (event.data[2] * 128) + event.data[1];
			$scope.bendPitch((1.0*bend/6144)-1);
		} else if (event.data[0] == 0xb0) { //control change
			changeParam(event.data[1], event.data[2]);
		}
	}
	
	function changeParam(index, change) {
		if (controlMaps[index]) {
			if (change > 64) {
				change -= 128;
			}
			var factor = 1.0/controlMaps[index].incr;
			var newValue = currentControlValues[index] + change*controlMaps[index].incr;
			newValue = Math.round(newValue*factor)/factor;
			setParam(index, newValue);
		} else if (toggleMaps[index] && change == 127) {
			setToggle(index);
		}
	}
	
	function setParam(index, value) {
		if (controlMaps[index] && controlMaps[index].min <= value && value <= controlMaps[index].max) {
			currentControlValues[index] = value;
			controlMaps[index].call(value);
			setDialStatus(index-71, controlMaps[index].name+' '+value);
		}
	}
	
	function setToggle(index) {
		setToggleStatus(index-20, toggleMaps[index].name);
		setToggleLight(index, toggleMaps[index].call());
	}
	
	function setToggleLight(index, isOn) {
		var color;
		if (isOn) {
			color = 4;
		} else {
			color = 0;
		}
		var noteOnMessage = [0xb0, index, color];
		sendMessageToPush(noteOnMessage);
	}
	
	function setPadLight(note) {
		var color = Math.floor(Math.random()*128);
		var noteOnMessage = [0x90, note, color];
		sendMessageToPush(noteOnMessage);
	}
	
	function setDialStatus(index, string) {
		if (index%2 == 0) {
			string = padRight(string, 9);
		} else {
			string = padRight(string, 8);
		}
		dialLine[index] = string;
		setDisplayLine(0, dialLine.join(""), false);
	}
	
	function setToggleStatus(index, string) {
		if (index%2 == 0) {
			string = padRight(string, 9);
		} else {
			string = padRight(string, 8);
		}
		toggleLine[index] = string;
		setDisplayLine(3, toggleLine.join(""), false);
	}
	
	function setDisplayLine(index, string) {
		var ascii = Array.prototype.map.call(string, function(c) { return c.charCodeAt(0); });
		while (ascii.length < 68) {
			ascii.push(32);
		}
		message = [71,127,21,24+index,0,69,0];
		message = message.concat(ascii);
		sendSysexMessageToPush(message);
	}
	
	function clearDisplayLine(index) {
		sendSysexMessageToPush([71,127,21,28+index,0,0]);
	}
	
	function sendMessageToPush(message) {
		if (pushOutput) {
			pushOutput.send(message);
		}
	}
	
	function sendSysexMessageToPush(message) {
		message.splice(0, 0, 240);
		message.push(247);
		sendMessageToPush(message);
	}
	
	function padRight(string, spaceCount) {
		var spaces = new Array(spaceCount+1).join(' ');
		if (string) {
			return (string + spaces).substring(0, spaces.length);
		}
		return spaces;
	}
	
}