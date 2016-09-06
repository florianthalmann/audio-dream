/**
 * @constructor
 */
function PushMidi(socket) {
	
	var midiAccess;
	if (navigator.requestMIDIAccess) {
		navigator.requestMIDIAccess().then(function(access) {
			midiAccess = access;
			init();
		});
	} else {
		console.log('No Web MIDI support');
	}
	
	init();
	
	function init() {
		var pushOutput;
		var iter = midiAccess.outputs.values();
		for (var i = iter.next(); i && !i.done; i = iter.next()) {
			if (i.value.name == 'Ableton Push User Port') {
				pushOutput = i.value;
			}
		}
		midiAccess.inputs.forEach(function(entry) {entry.onmidimessage = onMIDIMessage;});
		for (var i = 36; i < 100; i++) {
			setPadLight(i);
		}
	}
	
	function setPadLight(note) {
		var color = Math.floor(Math.random()*128);
		var noteOnMessage = [0x90, note, color];
		pushOutput.send( noteOnMessage );  //omitting the timestamp means send immediately.
	}
	
	/*function setStatusLine(index, string) {
		self.statusLine[index] = string
		status = ""
		for i in self.statusLine:
			status += str(self.statusLine[i]) + " | "
        self.setDisplayLine(3, status)*/
	
	function onMIDIMessage(event) {
		var str = "MIDI message received at timestamp " + event.timestamp + "[" + event.data.length + " bytes]: ";
		for (var i=0; i<event.data.length; i++) {
			str += "0x" + event.data[i].toString(16) + " ";
		}
		console.log(str, event.data);
		
		if (event.data[0] == 0x90) {
			//note on
		} else if (event.data[0] == 0x80) {
			//note off
		} else if (event.data[0] == 0xb0) {
			//control change
			if (event.data[1] == 1) {
				changeParam(0, event.data[2]);
			}
		}
	}
	
	function changeParam(param, value) {
		var request = new XMLHttpRequest();
		'changeParam'
		request.open('GET', 'changeParam?param='+param+'&value='+value, true);
		request.send();
	}
	
	function sendMiddleC( midiAccess, portID ) {
	  var noteOnMessage = [0x90, 60, 0x7f];    // note on, middle C, full velocity
	  var output = midiAccess.outputs.get(portID);
	  output.send( noteOnMessage );  //omitting the timestamp means send immediately.
	  output.send( [0x80, 60, 0x40], window.performance.now() + 1000.0 ); // Inlined array creation- note off, middle C,  
	                                                                      // release velocity = 64, timestamp = now + 1000ms.
	}
	
}