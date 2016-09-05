(function () {
	'use strict';

	angular.module('audioDream.controllers', [])
		.controller('MainController', ['$scope', '$http', function($scope, $http) {
			
			window.AudioContext = window.AudioContext || window.webkitAudioContext;
			var audioContext = new AudioContext();
			
			var currentInputSource, currentOutputDevice, recorder, recordingTimeout;
			var player = new AudioPlayer(audioContext, $scope);
			
			var midiAccess;
			
			if (navigator.requestMIDIAccess) {
				navigator.requestMIDIAccess().then(function(access) {
					midiAccess = access;
					midiAccess.inputs.forEach(function(entry) {entry.onmidimessage = onMIDIMessage;});
				});
			} else {
				console.log('No Web MIDI support');
			}
			
			///////// AUDIO IO ////////
			
			if (navigator.mediaDevices) {
				navigator.mediaDevices.enumerateDevices().then(function(devices) {
					$scope.audioInputDevices = devices.filter(function(d){return d.kind == "audioinput"});
					$scope.selectedAudioInputDevice = $scope.audioInputDevices[2];
					$scope.audioInputDeviceSelected();
					$scope.$apply();
				});
			}
			
			$scope.audioInputDeviceSelected = function() {
				var constraints = {
					deviceId: { exact: [$scope.selectedAudioInputDevice.deviceId] },
					echoCancellation: { exact: false }
				};
				navigator.mediaDevices.getUserMedia({audio: constraints})
				.then(function(audioStream) {
					if (currentInputSource) {
						currentInputSource.disconnect();
					}
					currentInputSource = audioContext.createMediaStreamSource(audioStream);
					currentInputSource.connect(audioContext.destination)
				})
				.catch(function(error) {
					console.log(error);
				});
			}
			
			///////// MIDI IO ////////
			
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
			
			///////// PLAYING AND RECORDING ////////
			
			$scope.startPlaying = function() {
				player.play();
			}
			
			$scope.stopPlaying = function() {
				player.stop();
			}
			
			$scope.startRecording = function() {
				if (currentInputSource && !recorder) {
					recorder = new Recorder(currentInputSource);
					recorder.record();
					keepRecording();
				}
			}
			
			function keepRecording() {
				if (currentInputSource && recorder) {
					recordingTimeout = setTimeout(function() {
						recorder.exportWAV(postBlob);
						keepRecording();
						recorder.clear();
					}, 5000);
				}
			}
			
			$scope.stopRecording = function() {
				if (recorder) {
					clearTimeout(recordingTimeout);
					recorder.stop();
					recorder = undefined;
				}
			}
			
			function postBlob(blob) {
				var request = new XMLHttpRequest();
				request.open('POST', 'postAudioBlob', true);
				request.onload = function() {
					console.log(this.responseText);
				};
				request.error = function(e){
					console.log(e);
				};
				request.send(blob);
			}
			
		}]);

}());
