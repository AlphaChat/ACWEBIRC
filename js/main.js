function Webchat(nickname, debug) {
    var me = {
        connected: false,
        userInfo: {nick: nickname},
        serverInfo: {caps:[]},
        supportedCaps: ['sasl', 'away-notify'],
        debugMode: debug
    },
        ws = [];

    me.disconnect = function () {
        if (ws) {
            sendData("QUIT :Bye.")
            ws.close();
        }
        if (me.debugMode) {
            console.log("[INFO] Disconnected (via disconnect())");
        }
    };

    function parseData(data) {
        if (me.debugMode) {
            console.log("[INFO] Parsing " + data);
            $("#ircData").append("<p> " + data + " </p><br />");
        }

        var tokens = data.split(' '),
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
                    value[1] = true
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

            if (tokens[0].charAt(0) == '' && tokens.length > 1) {

                tokens.shift();
                continue;

            } else if (tokens[0].charAt(0) == ':') {

                params.push(tokens.join(' ').substring(1));
                break;
            } else {
                params.push(tokens.shift());
            }
        }
        
        console.log(prefix);
        console.log(command);
        console.log(params);

        switch (command) {
            case 'PING':
                sendData("PONG " + params[0]);
                break;
            case 'CAP':
                if (params[1] == 'LS') {
                    var toSend = [];
                    arr = params[2].split(' ');
                    arr.forEach(function(value) {
                        if ($.inArray(value, me.supportedCaps) != -1) {
                            console.log("Both us and the server support " + value);
                            toSend.push(value);
                        }
                    });
                    sendData("CAP REQ :" + toSend.join(' '));
                }
                if (params[1] == 'ACK') {
                    sendData("CAP END");
                }
                break;
        }
    }

    function sendData(data) {
        ws.send(data + "\r\n");
        if (me.debugMode) {
            console.log("[INFO] Sending " + data);
        }
    }

    me.send = function(data) {
        sendData(data);
    }

    function construct() {
        // Initialize the WebSocket object
        ws = new SockJS("http://acwebirc.gentoo.party:26667/webirc/sockjs")
        // Apply handlers
        ws.onmessage = function(e) { parseData(e.data); };
        ws.onopen = function (e) {
            me.connected = true;
            sendData("CAP LS 301");
            sendData("NICK " + me.userInfo.nick);
            sendData("USER acwebchat * * :AlphaChat WebChat")
        };
        ws.onclose = function (e) {
            me.connected = false;
        };

        // Return ourselves
        return me;
    }

    return construct();
}
