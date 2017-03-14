function Webchat(nickname, debug) {

    var me = {
        connected: false,
        userInfo: {nick: nickname},
        serverInfo: {caps:[]},
        supportedCaps: ['sasl', 'away-notify'],
        debugMode: debug
    },
    ws = [],
    signals = {};

    me.disconnect = function () {
        if (ws) {
            sendData("QUIT :Bye.");
            ws.close();
        }
        if (me.debugMode) {
            console.log("[INFO] Disconnected (via disconnect())");
        }
    };

    function on(ev_name, ev_cb) {

        if(signals[ev_name]) {
            signals[ev_name].push(ev_cb);
        } else {
            signals[ev_name] = [ ev_cb ];
        }
    }

    function emit(ev_name, args) {

        if(! signals[ev_name]) {
            //console.log("[WARNING] no event handler for '" + ev_name + "'");
            return;
        }

        console.log("[DEBUG] emitting " + ev_name);

        signals[ev_name].forEach(function(ev_cb, index, array) {
            try {
                ev_cb(args);
            } catch(err) {
                console.log("[CRITICAL] error in " + ev_name + " callback " + ev_cb + ": " + err.message);
            }
        });
    }

    function parseData(data) {
        if (me.debugMode) {
            console.log("[DEBUG] Parsing " + data);
            $("#ircData").append("<p> " + data + " </p><br />");
        }

        var tokens = data.trim().split(' '),
            tags = {},
            prefix, command,
            params = [];

        // IRCv3.2 Message Tags
        if (tokens[0].charAt(0) === "@") {

            tag_str = tokens.shift();
            tag_str = tag_str.substring(1).split(';');
            tag_str.forEach(function(value, index, array) {

                // if a tag doesn't have a value, it means 'true'
                if(! value[1]) {
                    value[1] = true;
                }

                tags[value[0]] = value[1];
            });
        }

        // :PREFIX
        if (tokens[0].charAt(0) === ":") {
            prefix = tokens.shift().substring(1);
        }

        // :prefix COMMAND
        // COMMAND
        command = tokens.shift();

        // Iterate across remaining tokens
        while (tokens.length) {

            if (tokens[0].charAt(0) === '' && tokens.length > 1) {

                tokens.shift();
                continue;

            } else if (tokens[0].charAt(0) == ':') {

                params.push(tokens.join(' ').substring(1));
                break;
            } else {
                params.push(tokens.shift());
            }
        }

        var message = {

            "prefix": prefix,
            "command": command,
            "params": params,
            "tags": tags
        };

        console.log(JSON.stringify(message, null, 4));

        emit("irc cmd " + message.command.toLowerCase(), message);
    }

    // takes a message object and build it into a string that can be sent to the server
    function buildMessage(msgObj) {
        var tokens = [ ];

        if (msgObj.tags) {
            var tag_str = '@';

            msgObj.tags.forEach(function(value, index, array) {

                var kv = value.split(' ');
                tag_str += kv[0] + '=' + v[1];
            });

            tokens.push(tag_str);
        }

        if (msgObj.prefix)
            tokens.push(":" + msgObj.prefix);


        tokens.push(msgObj.command.toUpperCase());

        if (msgObj.params) {

            var param_tokens = [ ];
            msgObj.params.forEach(function(value, array, index) {

                if(value.indexOf(" ") == -1 && value[0] !== ':') {

                    param_tokens.push(value);
                } else {

                    param_tokens.push(":" + value);
                }

            });
            tokens.push(param_tokens.join(" "));
        }

        return tokens.join(" ");
    }

    function sendData(data) {
        ws.send(data + "\r\n");
        if (me.debugMode) {
            console.log("[INFO] Sending " + data);
        }
    }

    me.send = function(data) {
        sendData(data);
    };

    function sendMsg(msg) {

        on("client cmd " + msg.command.toLowerCase(), msg);
        sendData(buildMessage(msg));
    }

    function construct() {
        // Initialize the WebSocket object
        ws = new SockJS("http://acwebirc.gentoo.party:26667/webirc/sockjs");
        // Apply handlers
        ws.onmessage = function(e) { parseData(e.data); };
        ws.onopen = function (e) {
            me.connected = true;
            sendData("CAP LS 301");
            sendData("NICK " + me.userInfo.nick);
            sendData("USER acwebchat * * :AlphaChat WebChat");
        };
        ws.onclose = function (e) {
            me.connected = false;
        };

        on("irc cmd ping", function(msg) {

            sendMsg({
                command: "PONG",
                params: msg.params || [ ]
            });

        });

        on("irc cmd cap", function(msg) {

            // FIXME: proper CAPAB negotiation
            switch(msg.params[1]) {
                case "LS":
                    var capabs = msg.params[2].split(' ');
                    var toSend = [ ];
                     capabs.forEach(function(value) {
                        if ($.inArray(value, me.supportedCaps) != -1) {
                            toSend.push(value);
                        }
                    });
                    sendMsg({ command: "CAP", params: [ "REQ", toSend.join(" ") ] });
                    break;
                case "ACK":
                    sendMsg({ command: "CAP", params: [ "END" ] });
                    break;
            }
        });

        // Return ourselves
        return me;
    }

    return construct();
}
