function Webchat(nickname, debug) {

    var me = {
        connected: false,
        userInfo: {nick: nickname},
        channels: [ ],
        queries: [ ],
        serverInfo: {caps:[]},
        supportedCaps: ['sasl', 'away-notify', 'extended-join'],
        enabledCaps: [ ],
        debugMode: debug
    },
    ws = [],

    signals = {};
    signals_pending = [];

    var EAT_NONE = 1; // the default, keep emitting this signal
    var EAT_ALL = 4;  // if any callback returns this, stop emitting

    me.disconnect = function () {
        if (ws) {
            sendData("QUIT :Bye.");
            ws.close();
        }
        if (me.debugMode) {
            console.log("[INFO] Disconnected (via disconnect())");
        }
    };

    me.isCapEnabled = function(cap) {

        if (me.enabledCaps.indexOf(cap) !== -1)
            return true;
        return false;
    };

    function on(ev_name, ev_cb) {

        if(signals[ev_name]) {
            signals[ev_name].push(ev_cb);
        } else {
            signals[ev_name] = [ ev_cb ];
        }
    }

    /** a note on this emit/emit_now business
    *
    * emit() will queue an event to run as soon as possible, meaning it will let all other emit() calls
    * that occured before it to run first. if the queue is empty, emit() shorcuts right to emit_now().
    *
    * emit_now() will fire 1 event, then check to see if there are any pending events to run. if there's
    * no work to do, it shuts down and waits for emit() to start it back up.
    * -- sam
    **/

    function emit(ev_name, args) {

        // if there are pending signals, queue this to run as soon as possible
        // otherwise, run it now

        if(signals_pending.length) {
            signals_pending.append([ ev_name, args ]);
        } else {
            emit_now(ev_name, args);
        }

    }

    function emit_now(ev_name, args) {
        function _emit(ev_name, args) {
            if(! signals[ev_name]) {
                // no subscribers to this event so don't even bother.
                return;
            }

            var retval = EAT_NONE;
            signals[ev_name].forEach(function(ev_cb, index, array) {
                try {
                    retval = ev_cb(args);
                } catch(err) {
                    console.log("[CRITICAL] error in " + ev_name + " callback " + ev_cb + ": " + err.message);
                }

                if (retval === EAT_ALL)
                    return;
            });
        }
        _emit(ev_name, args);

        // runs until there are no more left to emit
        while(signals_pending.length) {
            next = signals_pending.shift();
            _emit(next[0], next[1]);
        }

    }

    function parseData(data) {
        data = data.trim();

        if (me.debugMode) {
            console.log("[DEBUG] Parsing " + data);
            $("#ircData").append("<p>" + data + "</p>");
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

    function createChanBuffer(chan) {
        me.channels.push(chan);

        $('#buffers').append('<div role="tabpanel" class="tab-pane fade" id="chan-' + chan +'"></div>');
        $('#menu-content').append('<li id="tab-chan-'+ chan + '"><a href="#chan-'+ chan + '" aria-controls="chan-' + chan + '" role="tab" data-toggle="tab"><i class="fa fa-hashtag fa-lg"></i> ' + chan + ' <span class="badge">3</span></a></li>');
    }

    function createQueryBuffer(query) {
        me.queries.push(query);

        $('#buffers').append('<div role="tabpanel" class="tab-pane fade" id="query-' + query +'"></div>');
        $('#menu-content').append('<li id="tab-query-'+ query + '"><a href="#query-'+ query + '" aria-controls="query-' + query + '" role="tab" data-toggle="tab"><i class="fa fa-comments fa-lg"></i> ' + query + ' <span class="badge">3</span></a></li>');
    }

    function appendBuffer(buffer, event, message) {
        $('#' + buffer).append('<p class="event ' + event + '">' + message + "</p>");
    }

    function appendChanBuffer(chan, event, message) {
        appendBuffer("chan-" + chan, event, message);
    }

    function appendQueryBuffer(query, event, message) {
        appendBuffer("query-" + query, event, message);
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
                params: msg.params || [ ] // handles servers with and without the pingcookie
            });

        });

        on("irc cmd cap", function(msg) {

            // FIXME: proper CAPAB negotiation
            switch(msg.params[1]) {
                case "LS":
                    if(! msg.params[2]) {
                        // no capabilities available
                        sendMsg({ command: "CAP", params: [ "END" ] });
                        return;
                    }
                    var capabs = msg.params[2].split(' ');
                    var toSend = [ ];
                     capabs.forEach(function(value) {
                        if ($.inArray(value, me.supportedCaps) != -1) {
                            toSend.push(value);
                            me.enabledCaps.push(value);
                        }
                    });
                    sendMsg({ command: "CAP", params: [ "REQ", toSend.join(" ") ] });
                    break;
                case "ACK":
                    sendMsg({ command: "CAP", params: [ "END" ] });
                    break;
            }
        });

        on("irc cmd 433", function(msg) {

            me.userInfo.nick += "_";
            sendMsg({ command: "NICK", params: [ me.userInfo.nick ] });
        });

        on("irc cmd join", function(msg) {

            // someone (possibly us) joined a channel
            var chan = msg.params[0].toLowerCase().substring(1);
            var nick = msg.prefix.split('!')[0];

            var account, realname;

            if (me.isCapEnabled("extended-join")) {
                account = (msg.params[1] === '*' ? null : msg.params[1]);
                realname = msg.params[2];
            }

            var joinmsg = "--> " + nick + " " + (account ? "[" + account + "] " : "") + (realname ? "(" + realname + ") " : "") + " has joined #" + chan;

            // TODO: lol fix this to use the correct casemapping xD
            if (nick === me.userInfo.nick) {

                if (me.channels.indexOf(chan) !== -1)
                    return; // uh we're already on that channel

                createChanBuffer(chan);
            }

            appendChanBuffer(chan, "user-join", joinmsg);
            // TODO: update the nicklist
        });

        on("irc cmd part", function(msg) {

            // someone (possibly us) left a channel
            var chan = msg.params[0];

            if (msg.prefix.startsWith(me.userInfo.nick)) {

                var idx = me.channels.indexOf(chan);
                if (idx !== -1)
                    me.channels.splice(idx, 1);

                // TODO: destroy the buffer
            }
            // TODO: show the user parting, remove them from the nicklist
        });

        on("irc cmd quit", function(msg) {

            // TODO: show the user quitting on ALL buffers, remove them from ALL nicklists

        });

        on("irc cmd nick", function(msg) {

            // someone changed their nick, possibly us
            var newnick = msg.params[0];

            if (msg.prefix.startsWith(me.userInfo.nick)) {

                me.userInfo.nick = newnick;
                // TODO: update any internal labels that display our nick to the user,
            }
            // TOCO: update all nicklists across all buffers
        });

        on("irc cmd privmsg", function(msg) {

            var target = msg.params[0].toLowerCase().substring(1);
            var text = msg.params[1];
            var nick = msg.prefix.split('!')[0];

            if (me.channels.indexOf(target) === -1) {

                if (me.queries.indexOf(nick) === -1)
                    createQueryBuffer(nick);

                appendQueryBuffer(nick, "user-query-msg", "&lt;" + nick + "&gt; " + text);

            } else {
                appendChanBuffer(target, "user-chan-msg", "&lt;" + nick + "&gt; " + text);
            }

        });

        // Return ourselves
        return me;
    }

    return construct();
}
