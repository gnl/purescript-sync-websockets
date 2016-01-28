'use strict';

// module Network.WebSockets.Sync.Socket

// TODO: how to deal with timeouts??? timeout 3 sec -> try next server?
// TODO: try another node after n failed reconnects
// TODO: implement ConnectToAnother node
// TODO: drop connection after x secs of inactivity to relieve server
// TODO: resend unsent sync messages on connect
// TODO: subscribe to subscribed threads on connect
// TODO: reconnect to previous node if node doesn't accept connections after handoff

function timeout(id, ms, cb) {
  var self = timeout;
  self.timeouts = self.timeouts || {};

  if (self.timeouts[id])
    clearTimeout(self.timeouts[id]);

  self.timeouts[id] = setTimeout(function() {
    delete self.timeouts[id];
    cb();
  }, ms);
}

// http://stackoverflow.com/a/1349426/634020
function makeid()
{
  var text = "";
  var possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghipqrstuvwxyz0123456789";

  for( var i=0; i < 16; i++ )
    text += possible.charAt(Math.floor(Math.random() * possible.length));

  return text;
}

function _send(si, msg) {
  if (si.socket && si.socket.readyState === 1) {
    si.socket.send(msg);
  }
  else {
    si.requests = si.requests || [];
    si.requests.push(msg);

    return false;
  }

  return true;
}

exports.sendImpl = function(si, msg) {
  return function() {
    _send(si, JSON.stringify({
      cmd: "async-request",
      request: JSON.parse(msg)
    }));
    return {};
  };
};

exports.sendSyncImpl = function(si, msg, callback) {
  return function() {
    var rid = makeid();

    si.sync_requests[rid] = callback;

    _send(si, JSON.stringify({
      cmd: "sync-request",
      rid: rid,
      request: JSON.parse(msg)
    }));
    return {};
  };
};

exports.setHandlersImpl = function(si, handlers) {
  return function() {
    si.handlers = handlers;
  };
};

exports.connectImpl = function(uri, handlers, si_old) {
  return function() {
    console.log("Connecting to " + uri + "...");

    if (si_old && si_old.socket) {
      si_old.socket.onclose = undefined;
      si_old.socket.onerror = undefined;
      si_old.socket.onmessage = undefined;
      si_old.socket.onopen = undefined;

      si_old.socket.close();
    }

    var si = si_old || {
      sync_requests: {},
      handlers: handlers,
      requests: []
    };
    si.socket = new WebSocket(uri);

    /*
    window.addEventListener("beforeunload", function() {
      si.socket.close();
    });
    */

    si.socket.onopen = function() {
      if (si.handlers.connected != null) {
        var r = si.handlers.connected(si);

        // PureScript returns thunk
        if (typeof r === "function")
          r();
      }

      // send all outstanding requests
      var requests = si.requests || [];

      // send until all requests are sent or there's an error again
      while (requests.length > 0 && _send(si, requests.shift()))
        ;
    }

    si.socket.onmessage = function(msg) {
      var data = JSON.parse(msg.data);

      console.log(data);

      if (data && "sync-response" === data.cmd) {
        if (data.rid) {
          if (data.response && si.sync_requests[data.rid]) {
            var r = si.sync_requests[data.rid](JSON.stringify(data.response));

            // PureScript returns thunk
            if (typeof r === "function")
              r();

          }
          else if (data.error) {
            console.error(data.error);
          }

          delete si.sync_requests[data.rid];
        }
      }
      else if (data && "async-message" === data.cmd) {
        if (data.message != null)
          var r = si.handlers.message(JSON.stringify(data.message));

          // PureScript returns thunk
          if (typeof r === "function")
            r();
      }
    }

    si.socket.onerror = function(error) {
      console.error("Socket error (" + uri + "): " + error);

      if (si.handlers.disconnected != null) si.handlers.disconnected();
      timeout(uri, 3000, function() {exports.connectImpl(uri, si.handlers, si)();});
    }

    si.socket.onclose = function() {
      console.error("Closing socket to " + uri + "...");

      if (si.handlers.disconnected != null) si.handlers.disconnected();
      timeout(uri, 3000, function() {exports.connectImpl(uri, si.handlers, si)();});
    }

    return si;
  };
};