(function () {
	'use strict';

	angular.module('audioDream.controllers', [])
		.controller('MainController', ['$scope', '$http', function($scope, $http) {
			
			var socket = io();
			
			window.AudioContext = window.AudioContext || window.webkitAudioContext;
			var audioContext = new AudioContext();
			
			var currentInputSource, currentOutputDevice, recorder, recordingTimeout;
			var player = new AudioPlayer(audioContext, $scope, socket);
			var pushMidi = new PushMidi(socket);
			var analyser = audioContext.createAnalyser();
			analyser.fftSize = 32;
			var fftData = new Uint8Array(analyser.frequencyBinCount);
			var isAnalyzing;
			var previousAmps = [0,0,0];
			
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
					currentInputSource.connect(analyser);
				})
				.catch(function(error) {
					console.log(error);
				});
			}
			
			///////// ANALYZING AND TRIGGERING ////////
			
			function startAnalyzing() {
				if (!isAnalyzing) {
					isAnalyzing = true;
					keepAnalyzing();
				}
			}
			
			function keepAnalyzing() {
				if (isAnalyzing) {
					analyser.getByteFrequencyData(fftData);
					var currentAmp = fftData.reduce(function(a,b){return a+b;}, 0);
					previousAmps.unshift(currentAmp);
					previousAmps.pop();
					var sortedAmps = previousAmps.slice().sort();
					console.log(previousAmps, sortedAmps)
					//amp going down
					if (JSON.stringify(previousAmps)==JSON.stringify(sortedAmps)) {
						console.log("play")
						player.play();
					//amp going up
					} else {
						sortedAmps.reverse();
						if (JSON.stringify(previousAmps)==JSON.stringify(sortedAmps)) {
							console.log("stop")
							player.stop();
						}
					}
					setTimeout(function() {
						keepAnalyzing();
					}, 1000);
				}
			}
			
			function stopAnalyzing() {
				isAnalyzing = false;
			}
			
			///////// PLAYING AND RECORDING ////////
			
			$scope.startPlaying = function() {
				player.play();
				startAnalyzing();
			}
			
			$scope.stopPlaying = function() {
				stopAnalyzing();
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
					}, 10000);
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
