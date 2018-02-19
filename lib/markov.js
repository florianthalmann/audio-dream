"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const _ = require("lodash");
class MarkovChain {
    constructor(sentences, order = 4) {
        this.order = order;
        this.model = {};
        this.learn(sentences);
    }
    replaceSentences(sentences) {
        this.learn(sentences);
    }
    learn(sentences) {
        let data = _.repeat('~', this.order) + sentences.join('');
        for (let i of _.range(this.order, data.length - 1)) {
            let history = data.slice(i - this.order, i);
            let char = data[i];
            if (!this.model[history])
                this.model[history] = {};
            let probs = this.model[history];
            probs[char] = (char in probs) ? probs[char] + 1 : 1;
        }
        _.forOwn(this.model, (probs, history) => {
            let sum = _.sum(_.values(probs));
            _.forEach(probs, (v, char) => probs[char] = v / sum);
        });
        console.log("lm learned, size is", _.keys(this.model).length);
    }
    sample(history = _.repeat('~', this.order), length = 20) {
        let output = "";
        while (output.length < length) {
            let char = this.generateChar(history + output);
            if (char) {
                output += char;
            }
            else {
                console.log("end of model reached!");
                return this.sample(); //start afresh
            }
        }
        return output;
    }
    generateChar(history) {
        history = history.slice(-this.order);
        let p = Math.random();
        let c = _.keys(this.model[history]).find(char => {
            p -= this.model[history][char];
            return p <= 0;
        });
        return c;
    }
}
exports.MarkovChain = MarkovChain;
