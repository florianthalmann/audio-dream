(function () {
	'use strict';

	angular.module('audioDream.controllers', [])
		.controller('MainController', ['$scope', '$http', function($scope, $http) {
			
			var socket = io();
			
			window.AudioContext = window.AudioContext || window.webkitAudioContext;
			var audioContext = new AudioContext();
			
			var LISTENING_THRESHOLD = 3;
			var RECORDING_LENGTH = 10; //in seconds
			
			var isRecording, isPlaying;
			
			var aiConsolePadding = new Array(20);
			var aiConsoleLines = [];
			
			socket.on('aiOutput', function (data) {
				addAiConsoleLine(data.text);
			});
			
			function addAiConsoleLine(text) {
				aiConsoleLines.push(text);
				while (aiConsoleLines.length > 5) {
					aiConsoleLines.shift();
				}
				$scope.aiConsole = aiConsolePadding.join('\n').concat(aiConsoleLines.join('\n'));
				$scope.$apply();
			}
			
			///////// AUDIO IO ////////
			
			if (navigator.mediaDevices) {
				navigator.mediaDevices.enumerateDevices().then(function(devices) {
					$scope.audioInputDevices = devices.filter(function(d){return d.kind == "audioinput"});
					console.log($scope.audioInputDevices[2])
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
					var dryGain = audioContext.createGain();
					//dryGain.connect(audioContext.destination);
					dryGain.gain.value = 0.5;
					currentInputSource.connect(dryGain);
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
					//console.log(previousAmps, sortedAmps)
					//amp going down
					if (JSON.stringify(previousAmps)==JSON.stringify(sortedAmps)) {
						console.log(addAiConsoleLine("Auto playing"))
						player.play();
					//amp going up
					} else {
						sortedAmps.reverse();
						if (JSON.stringify(previousAmps)==JSON.stringify(sortedAmps)) {
							console.log(addAiConsoleLine("Auto stopped"))
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
			
			$scope.changeMaxNumFragments = function(value) {
				socket.emit('changeMaxNumFragments', {value:value});
			}
			
			$scope.changeClusterProportion = function(value) {
				socket.emit('changeClusterProportion', {value:value});
			}
			
			$scope.changeListeningThreshold = function(threshold) {
				LISTENING_THRESHOLD = threshold;
			}
			
			$scope.changeRecordingLength = function(length) {
				RECORDING_LENGTH = length;
			}
			
			$scope.clearMemory = function() {
				socket.emit('clearMemory');
			}
			
			$scope.toggleAutoPlay = function() {
				if (!isAnalyzing) {
					startAnalyzing();
					return true;
				} else {
					stopAnalyzing();
					return false;
				}
			}
			
			$scope.togglePlaying = function() {
				if (!player.isPlaying()) {
					$scope.startPlaying();
					return true;
				} else {
					$scope.stopPlaying();
					return false;
				}
			}
			
			$scope.startPlaying = function() {
				player.play();
			}
			
			$scope.stopPlaying = function() {
				player.stop();
			}
			
			$scope.toggleRecording = function() {
				if (!recorder) {
					$scope.startRecording();
					return true;
				} else {
					$scope.stopRecording();
					return false;
				}
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
					}, RECORDING_LENGTH*1000);
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
			
			///////// INIT ///////
			var currentInputSource, currentOutputDevice, recorder, recordingTimeout;
			var player = new AudioPlayer(audioContext, $scope, socket);
			var pushMidi = new PushMidi(socket, $scope);
			var sampler = new Sampler(audioContext, player.getMainGain(), $scope);
			
			var analyser = audioContext.createAnalyser();
			analyser.fftSize = 32;
			var fftData = new Uint8Array(analyser.frequencyBinCount);
			var isAnalyzing;
			var previousAmps = [0,0,0];
			
		}]);

}());
