// Copyright (c) 2015 Uber Technologies, Inc.
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
// THE SOFTWARE.

'use strict';

var inherits = require('util').inherits;
var EventEmitter = require('events').EventEmitter;

var TChannelPeer = require('./peer');
var TChannelSelfPeer = require('./self_peer');

function TChannelPeers(channel, options) {
    if (!(this instanceof TChannelPeers)) {
        return new TChannelPeers(channel, options);
    }
    var self = this;
    EventEmitter.call(self);
    self.channel = channel;
    self.logger = self.channel.logger;
    self.options = options || {};
    self._map = Object.create(null);
    self.selfPeer = TChannelSelfPeer(self.channel);
}

inherits(TChannelPeers, EventEmitter);

TChannelPeers.prototype.close = function close(callback) {
    var self = this;
    var peers = [self.selfPeer].concat(self.values());
    var counter = peers.length;
    peers.forEach(function eachPeer(peer) {
        peer.close(onClose);
    });
    self.clear();

    function onClose() {
        if (--counter <= 0) {
            if (counter < 0) {
                self.logger.error('closed more peers than expected', {
                    counter: counter
                });
            }
            callback();
        }
    }
};

TChannelPeers.prototype.get = function get(hostPort) {
    var self = this;
    return self._map[hostPort] || null;
};

TChannelPeers.prototype.add = function add(hostPort, options) {
    var self = this;
    var peer = self._map[hostPort];
    if (!peer) {
        if (hostPort === self.channel.hostPort) {
            return self.selfPeer;
        }
        if (self.channel.topChannel) {
            peer = self.channel.topChannel.peers.add(hostPort);
        } else {
            peer = TChannelPeer(self.channel, hostPort, options);
            self.emit('allocPeer', peer);
        }
        self._map[hostPort] = peer;
    }
    return peer;
};

TChannelPeers.prototype.addPeer = function addPeer(peer) {
    var self = this;
    if (!(peer instanceof TChannelPeer)) {
        throw new Error('invalid peer'); // TODO typed error
    }
    if (self._map[peer.hostPort]) {
        throw new Error('peer already defined'); // TODO typed error
    }
    if (peer.hostPort !== self.channel.hostPort) {
        self._map[peer.hostPort] = peer;
    }
};

TChannelPeers.prototype.keys = function keys() {
    var self = this;
    return Object.keys(self._map);
};

TChannelPeers.prototype.values = function values() {
    var self = this;
    var keys = Object.keys(self._map);
    var ret = new Array(keys.length);
    for (var i = 0; i < keys.length; i++) {
        ret[i] = self._map[keys[i]];
    }
    return ret;
};

TChannelPeers.prototype.entries = function entries() {
    var self = this;
    var keys = Object.keys(self._map);
    var ret = new Array(keys.length);
    for (var i = 0; i < keys.length; i++) {
        ret[i] = [keys[i], self._map[keys[i]]];
    }
    return ret;
};

TChannelPeers.prototype.clear = function clear() {
    var self = this;
    var keys = self.keys();
    var vals = new Array(keys.length);
    for (var i = 0; i < keys.length; i++) {
        vals[i] = self._map[keys[i]];
        delete self._map[keys[i]];
    }
    return vals;
};

TChannelPeers.prototype.delete = function del(hostPort) {
    var self = this;
    var peer = self._map[hostPort];
    delete self._map[hostPort];
    if (self.subChannels) {
        var names = Object.keys(self.subChannels);
        for (var i = 0; i < names.length; i++) {
            self.subChannels[names[i]].delete(hostPort);
        }
    }
    return peer;
};

TChannelPeers.prototype.request = function peersRequest(options) {
    var self = this;
    var peer = self.choosePeer(options, null);

    if (!peer) {
        // TODO: operational error?
        throw new Error('no peer available for request'); // TODO: typed error
    }

    return peer.request(options);
};

TChannelPeers.prototype.choosePeer = function choosePeer(options, req) {
    var self = this;

    if (!options) options = {};
    var hosts = null;
    if (options.host) {
        return self.add(options.host);
    } else {
        hosts = Object.keys(self._map);
    }
    if (!hosts || !hosts.length) return null;

    var threshold = options.peerScoreThreshold;
    if (threshold === undefined) threshold = self.options.peerScoreThreshold;
    if (threshold === undefined) threshold = 0;

    var selectedPeer = null, selectedScore = 0;
    for (var i = 0; i < hosts.length; i++) {
        var peer = self.add(hosts[i]);
        var score = peer.state.shouldRequest(req, options);
        var want = score > threshold &&
                   (selectedPeer === null || score > selectedScore);
        if (want) {
            selectedPeer = peer;
            selectedScore = score;
        }
    }
    return selectedPeer;
};

module.exports = TChannelPeers;
