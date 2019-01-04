(function () {
	'use strict';

	angular.module('audioDream.controllers', [])
		.controller('MainController', ['$scope', '$http', function($scope, $http) {

			var socket = io();

			//window.AudioContext = window.AudioContext || window.webkitAudioContext;
			//var audioContext = new AudioContext();
			//Tone.context.resume();

			var audioContext = Tone.context;

			var LISTENING_THRESHOLD = 3;
			var RECORDING_LENGTH = 10; //in seconds

			var isRecording, isPlaying;

			var aiConsolePadding = new Array(12);
			var aiConsoleLines = [];

			socket.on('aiOutput', function (data) {
				addAiConsoleLine(data.text);
			});

			function addAiConsoleLine(text) {
				aiConsoleLines.push(text);
				while (aiConsoleLines.length > 10) {
					aiConsoleLines.shift();
				}
				$scope.aiConsole = aiConsolePadding.join('\n').concat(aiConsoleLines.join('\n'));
				setTimeout(function() {
					$scope.$apply();
				}, 10);
			}

			///////// AUDIO IO ////////

			if (navigator.mediaDevices) {
				navigator.mediaDevices.enumerateDevices().then(function(devices) {
					$scope.audioInputDevices = devices.filter(function(d){return d.kind == "audioinput"});
					console.log($scope.audioInputDevices)
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
					dryGain.connect(audioContext.destination);
					dryGain.gain.value = 1;
					currentRecordedNode = audioContext.createGain();
					var splitter = audioContext.createChannelSplitter();
					var merger = audioContext.createChannelMerger();
					//currentRecordedNode.connect(dryGain);
					currentRecordedNode.connect(analyser);
					currentInputSource.connect(splitter);
					splitter.connect(merger, 0, 0);
					splitter.connect(merger, 0, 1);
					merger.connect(currentRecordedNode);
					sampler = new Sampler(audioContext, [player.getMainGain(), currentRecordedNode], $scope);
					new PushMidi(socket, $scope);
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
					if (!player.isPlaying() && JSON.stringify(previousAmps)==JSON.stringify(sortedAmps)) {
						addAiConsoleLine("Auto playing")
						player.play();
					//amp going up
					} else {
						sortedAmps.reverse();
						if (player.isPlaying() && JSON.stringify(previousAmps)==JSON.stringify(sortedAmps)) {
							addAiConsoleLine("Auto stopped")
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
				aiConsoleLines.push("started playing");
				player.play();
			}

			$scope.stopPlaying = function() {
				aiConsoleLines.push("stopped playing");
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
				aiConsoleLines.push("started listening");
				if (currentRecordedNode && !recorder) {
					recorder = new Recorder(currentRecordedNode);
					recorder.record();
					keepRecording();
				}
			}

			function keepRecording() {
				if (currentRecordedNode && recorder) {
					recordingTimeout = setTimeout(function() {
						recorder.exportWAV(postBlob);
						keepRecording();
						recorder.clear();
					}, RECORDING_LENGTH*1000);
				}
			}

			$scope.stopRecording = function() {
				aiConsoleLines.push("stopped listening");
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
			var currentInputSource, currentRecordedNode, currentOutputDevice, recorder, recordingTimeout;
			var player = new AudioPlayer(Tone, $scope, socket);
			var sampler;

			var analyser = audioContext.createAnalyser();
			analyser.fftSize = 32;
			var fftData = new Uint8Array(analyser.frequencyBinCount);
			var isAnalyzing;
			var previousAmps = [0,0,0];

		}]);

}());
