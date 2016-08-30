(function () {
	'use strict';

	angular.module('audioDream.controllers', [])
		.controller('MainController', ['$scope', '$http', function($scope, $http) {
			
			window.AudioContext = window.AudioContext || window.webkitAudioContext;
			var audioContext = new AudioContext();
			
			var currentInputDevice, recorder, recordingTimeout;
			var player = new AudioPlayer(audioContext);
			player.play();
			
			navigator.mediaDevices.enumerateDevices().then(function(devices) {
				$scope.audioInputDevices = devices.filter(function(d){return d.kind == "audioinput"});
				$scope.selectedAudioInputDevice = $scope.audioInputDevices[0];
				$scope.audioInputDeviceSelected();
				$scope.$apply();
			});
			
			$scope.audioInputDeviceSelected = function() {
				navigator.mediaDevices.getUserMedia({audio: {deviceId: {exact: $scope.audioInputDevices.deviceID}}})
				.then(function(audioStream) {
					currentInputDevice = audioContext.createMediaStreamSource(audioStream);
					console.log('input device selected');
				})
				.catch(function(error) {
					console.log(error);
				});
			}
			
			$scope.startPlaying = function() {
				player.play();
			}
			
			$scope.stopPlaying = function() {
				player.stop();
			}
			
			$scope.startRecording = function() {
				if (currentInputDevice && !recorder) {
					recorder = new Recorder(currentInputDevice);
					recorder.record();
					keepRecording();
				}
			}
			
			function keepRecording() {
				if (currentInputDevice && recorder) {
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
