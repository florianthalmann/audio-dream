var Kmeans = {};
module.exports = Kmeans;

(function(global) {
	"use strict";
	
	var clusterfck = require('clusterfck');
	
	var FIRST_CHAR = 32;
	var MEASURE_CONTINUITY_WITH_INTERSECTION = true;
	
	var Clustering = function(server) {
		
		var clusters, centroids;
		
		//clusterFactor is the proportional amount of clusters per fragment, e.g. 0.1 is 1 cluster per 10 fragments
		this.cluster = function(vectors, clusterFactor) {
			var previousClusters = clusters;
			var previousCentroids = centroids;
			var clusterCount = Math.min(128, Math.round(vectors.length*clusterFactor));
			//clusters with the indices of all feature vectors
			var kmeans = new clusterfck.Kmeans();
			clusters = kmeans.cluster(vectors, clusterCount);
			clusters = clusters.map(function(c){return c.map(function(v){return vectors.indexOf(v);})});
			centroids = kmeans.centroids;
			server.emitInfo("clustered " + vectors.length + " vectors into " + clusters.length + " clusters");
			if (previousClusters && previousCentroids) {
				permuteClustersForContinuity(previousClusters, previousCentroids);
			}
		}
		
		function permuteClustersForContinuity(previousClusters, previousCentroids) {
			var clusterPermutation;
			if (MEASURE_CONTINUITY_WITH_INTERSECTION) {
				var iMatrix = getIntersectionMatrix(previousClusters, clusters);
				clusterPermutation = getClusterPermutation(iMatrix, false);
			} else {
				var dMatrix = getDistanceMatrix(previousCentroids, centroids);
				clusterPermutation = getClusterPermutation(dMatrix, true);
			}
			while (clusterPermutation.length < clusters.length) {
				clusterPermutation.push(clusterPermutation.length);
			}
			var newClusters = [], newCentroids = [];
			for (var i = 0; i < clusters.length; i++) {
				if (i < clusterPermutation.length) {
					newClusters.push(clusters[clusterPermutation[i]]);
					newCentroids.push(centroids[clusterPermutation[i]]);
				}
			}
			clusters = newClusters;
			centroids = newCentroids;
		}
		
		this.length = function() {
			return clusters.length;
		}
		
		//returns a list with the fragment index for each element of the clusters in order
		this.getClusterSequence = function() {
			var sequence = [];
			for (var i = 0; i < clusters.length; i++) {
				if (clusters[i]) {
					for (var j = 0; j < clusters[i].length; j++) {
						sequence.push(clusters[i][j]);
					}
				}
			}
			return sequence;
		}
		
		//returns a list with the cluster index for each vector in the original list
		this.getIndexSequence = function() {
			var clusterIndices = [];
			for (var i = 0; i < clusters.length; i++) {
				if (clusters[i]) {
					for (var j = 0; j < clusters[i].length; j++) {
						clusterIndices[clusters[i][j]] = i;
					}
				}
			}
			return clusterIndices;
		}
		
		//returns a string with the cluster char for each vector in the original list
		this.getCharSequence = function() {
			return this.getIndexSequence().map(function(i){return indexToChar(i);}).join('');
		}
		
		this.toValidCharSequence = function(sequence) {
			for (var i = sequence.length-1; i >= 0; i--) {
				if (charToIndex(sequence[i]) >= clusters.length) {
					sequence = sequence.slice(0,i) + sequence.slice(i+1);
				}
			}
			return sequence;
		}
		
		this.getClusters = function() {
			return clusters;
		}
		
		this.getCentroids = function() {
			return centroids;
		}
		
		this.getClusterElements = function(index) {
			return clusters[index];
		}
		
		//returns the fragment index of a random element of a cluster
		this.getRandomClusterElement = function(char) {
			var clusterElements = clusters[charToIndex(char)];
			if (clusterElements) {
				return clusterElements[Math.floor(Math.random()*clusterElements.length)];
			}
			return '';
		}
		
		function indexToChar(index) {
			return String.fromCharCode(FIRST_CHAR+index);
		}
		
		function charToIndex(char) {
			return char.charCodeAt(0)-FIRST_CHAR;
		}
		
		function getClusterPermutation(matrix, ascendingSimilarity) {
			var elements = getOrderedElements(matrix, ascendingSimilarity);
			var oldNew = [];
			var i = 0;
			while (Object.keys(oldNew).length < matrix.length && i < matrix.length) {
				var currentPair = elements[i].coords;
				var currentKeys = Object.keys(oldNew);
				var currentValues = currentKeys.map(function(k){return oldNew[k];});
				if (currentKeys.indexOf(currentPair[0].toString()) < 0 && currentValues.indexOf(currentPair[1]) < 0) {
					oldNew[currentPair[0]] = currentPair[1];
				}
				i++;
			}
			return oldNew;
		}
	
		function getOrderedElements(matrix, ascending) {
			var orderedElements = [];
			for (var i = 0; i < matrix.length; i++) {
				for (var j = 0; j < matrix[i].length; j++) {
					orderedElements.push({value:matrix[i][j], coords:[i,j]});
				}
			}
			if (ascending) {
				orderedElements.sort(function(a, b) {return a.value - b.value;});
			} else {
				orderedElements.sort(function(a, b) {return b.value - a.value;});
			}
			return orderedElements;
		}
	
		function getIntersectionMatrix(a, b) {
			var intersections = [];
			for (var i = 0; i < a.length; i++) {
				var currentCol = [];
				for (var j = 0; j < b.length; j++) {
					currentCol.push(getIntersection(a[i], b[j]).length);
				}
				intersections.push(currentCol);
			}
			return intersections;
		}
	
		function getIntersection(a, b) {
			if (a && b) {
				var t;
				if (b.length > a.length) t = b, b = a, a = t; // indexOf to loop over shorter
				return a.filter(function (e) {
					if (b.indexOf(e) !== -1) return true;
				});
			}
			return [];
		}
	
		function getDistanceMatrix(a, b) {
			var distances = [];
			for (var i = 0; i < a.length; i++) {
				var currentCol = [];
				for (var j = 0; j < b.length; j++) {
					currentCol.push(getEuclideanDistance(a[i], b[j]));
				}
				distances.push(currentCol);
			}
			return distances;
		}
	
		function getEuclideanDistance(a, b) {
			var lim = Math.min(a.length, b.length);
			var dist = 0;
			for (var i = 0; i < lim; i++) {
				dist += Math.pow(a[i]-b[i], 2);
			}
			return Math.sqrt(dist);
		}
		
	}
	
	global.Clustering = Clustering;
	
})(Kmeans);