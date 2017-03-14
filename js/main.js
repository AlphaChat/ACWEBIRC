function Webchat(nickname, debug) {

    var me = {
        connected: false,
        userInfo: {nick: nickname},
        channels: { },
        registered: false,
        users: { },
        isupport: { },
        supportedCaps: ['sasl', 'away-notify', 'extended-join', 'chghost', 'userhost-in-names'],
        enabledCaps: [ ],
        debugMode: debug
    },
    ws = [],
    signals = {},
    signals_pending = [],
    mode2prefix = { };

    function User(prefix, real, acct) {

        var nuh = prefix.split("!", 2);
        var uh = nuh[1].split("@", 2);

        this.nick = nuh[0];
        this.user = uh[0];
        this.host = uh[1];
        this.real = real || '';
        this.acct = acct || '';
        this.channels = { };
        this.hasBuffer = false;


        this.userHost = function() {

            return nick.user + "@" + nick.host;
        };

        this.findChan = function(name) {
            return this.channels[name];
        };

        this.addChan = function(chan) {

            this.channels[chan.name] = chan;
        };

        this.delChan = function(name) {
            delete this.channels[name];
        };

        this.renameBuffer = function(newname) {
            var oldname = this.nick;

            $('#buffers').each(function(index) {
                console.log("buffers " + index + " id is "+ $(this).attr("id") );
                if ($(this).attr("id") === "query-" + oldname) {
                    console.log("renaming buffer tab from" + oldname + " to " + newname);
                    $(this).set("id", "query-" + newname);
                }
            });

            $('#menu-content').each(function(index) {
                console.log("menu-content " + index + " id is "+ $(this).attr("id") );
                if ($(this).attr("id") === "tab-query-" + oldname) {
                    console.log("renaming buffer display from " + oldname + " to " + newname);
                    $(this).set("id", "tab-query-", newname);
                }
            });
        };

        this.createBuffer = function() {
            this.hasBuffer = true;
            $('#buffers').append('<div role="tabpanel" class="tab-pane fade" id="query-' + this.nick +'"></div>');
            $('#menu-content').append('<li id="tab-query-'+ this.nick + '"><a href="#query-'+ this.nick + '" aria-controls="query-' + this.nick + '" role="tab" data-toggle="tab"><i class="fa fa-comments fa-lg"></i> ' + this.nick + ' <span class="badge">3</span></a></li>');
        };

        this.appendBuffer = function(event, message) {
            if (! this.hasBuffer)
                this.createBuffer();

            var ts = new Date();
            $('#query-' + this.nick).append('<p class="event ' + event + '"><span class="timestamp">[' + ts.toLocaleTimeString() + ']</span> ' + message + "</p>");
        };

        this.print = function(event, message) {
            this.appendBuffer(event, message);
        };
    }

    function Channel(name) {
        this.name = name;
        this.users = { };
        this.topic = '';
        this.hasBuffer = false;

        this.createBuffer = function() {
            $('#buffers').append('<div role="tabpanel" class="tab-pane fade" id="chan-' + this.name +'"></div>');
            $('#menu-content').append('<li id="tab-chan-'+ this.name + '"><a href="#chan-'+ this.name + '" aria-controls="chan-' + this.name + '" role="tab" data-toggle="tab"><i class="fa fa-hashtag fa-lg"></i> ' + this.name + ' <span class="badge">3</span></a></li>');
            this.hasBuffer = true;
        };

        this.appendBuffer = function (event, message) {
            if (! this.hasBuffer)
                this.createBuffer();

            var ts = new Date();
            $('#chan-' + this.name).append('<p class="event ' + event + '"><span class="timestamp">[' + ts.toLocaleTimeString() + ']</span> ' + message + "</p>");
        };

        this.print = function(event, message) {
            this.appendBuffer(event, message);

        };

        this.addUser = function(user) {

            this.users[user.nick] = user;
        };

        this.findUser = function(nick) {
            return this.users[nick];
        };

        this.delUser = function(nick) {
            delete this.users[nick];
        };

    }

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

        if(! signals[ev_name])
            return false;

        if(signals_pending.length) {
            signals_pending.push([ ev_name, args ]);
        } else {
            emit_now(ev_name, args);
        }
        return true;
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

        // if there aren't any event handlers for this, dump it to the status window
        if(! emit("irc cmd " + message.command.toLowerCase(), message))
            message.prefix ?
                $("#ircData").append('<p class="event server-raw-prefixed"> !' + message.prefix + " " + message.params.join(" ") + "</p>") :
                $("#ircData").append('<p class="event server-raw> -!- ' + message.params.join(" ") + "</p>");
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

    function findUser(nick) {

        nick = nick.split("!", 1)[0]; // just in case we get a prefix
        return me.users[nick];
    }

    function addUser(user) {

        me.users[user.nick] = user;
    }

    function delUser(nick) {

        delete me.users[nick];
    }

    function findChan(chan) {

        return me.channels[chan];
    }

    function addChan(chan) {

        me.channels[chan.name] = chan;
    }

    function delChan(name) {

       delete me.channels[name];
    }

    function parsePrefixes() {

        if (! me.isupport.PREFIX)
            return;

        var modes = [];
        var prefixes = [];
        var in_modes = true;
        var prefixstr = me.isupport.PREFIX;

        for (var i = prefixstr - 1; i >= 0; i--) {

            if(prefixstr[i] === "(")
                continue;

            if(prefixstr[i] === ")") {
                in_modes = false;
                continue;
            }

            if(in_modes) {
                modes.push(prefixstr[i]);
                continue;
            }

            prefixes.push(prefixstr[i]);
        }

        for (var n = 0; n < modes.length; n++) {
            mode2prefix[modes[n]] = prefies[n];
        }

    }

    function construct() {
        // Initialize the WebSocket object
        ws = new SockJS("http://acwebirc.gentoo.party:26667/webirc/sockjs");
        // Apply handlers
        ws.onmessage = function(e) { parseData(e.data); };
        ws.onopen = function (e) {
            me.connected = true;
            sendData("CAP LS 302");
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

            if (me.registered)
                return;

            me.userInfo.nick += "_";
            sendMsg({ command: "NICK", params: [ me.userInfo.nick ] });
        });

        on("irc cmd join", function(msg) {

            // someone (possibly us) joined a channel

            var name = msg.params[0].toLowerCase().substring(1);

            var account;
            var realname;
            var c;
            var u;

            if (me.isCapEnabled("extended-join")) {
                account = (msg.params[1] === '*' ? null : msg.params[1]);
                realname = msg.params[2];
            }

            c = findChan(name);
            if (! c) {

                c = new Channel(name);
                c.createBuffer();

                addChan(c);
            }

            u = findUser(msg.prefix);
            if (! u) {
                u = new User(msg.prefix, realname, account);

                u.addChan(c);
                c.addUser(u);

                addUser(u);
            }

            var joinmsg = "--> " + u.nick + " " + (account ? "[" + account + "] " : "") + (realname ? "(" + realname + ") " : "") + " has joined #" + name;
            c.print("user-join", joinmsg);

            // TODO: update the nicklist
        });

        on("irc cmd part", function(msg) {

            // someone (possibly us) left a channel
            var name = msg.params[0].toLowerCase().substring(1);

            var reason = msg.params[1];

            var c = findChan(name);
            var u = findUser(msg.prefix);

            if (! c || ! u)
                return;

            if (u.nick == me.userInfo.nick) {
                delChan(c.name);
                // TODO: destroy the buffer
                return;
            }

            c.delUser(u.nick);
            u.delChan(c.name);

            c.print("user-part", "<-- " + u.nick + " parted #" + name + ( reason ? " (" + reason + ")" : "" ));
            // TODO: remove user from the nicklist
        });

        on("irc cmd quit", function(msg) {

            // TODO: find each buffer a user is in and display them quitting + delete from nicklist
            var reason = msg.params[0];

            u = findUser(msg.prefix);
            if(! u)
                return;

            u.channels.forEach(function(c) {

                c.delUser(u.nick);
                c.print("user-quit", "<-- " + u.nick + " (" + u.userHost() + ") quit" + (reason ? " (" + reason + ")" : ""));
            });

            delUser(u.nick);

        });

        on("irc cmd nick", function(msg) {

            // someone changed their nick, possibly us
            var newnick = msg.params[0];

            var u = findUser(msg.prefix);
            if (u) {

                u.nick = newnick;
                u.renameBuffer(newnick);
            }
            // TOCO: update all nicklists across all buffers, and any rename any query windows
        });

        on("irc cmd privmsg", function(msg) {

            var nick = msg.prefix.split("!", 1)[0];
            var target = msg.params[0];
            var text = msg.params[1];

            var c, u;

            c = findChan(target.toLowerCase().substring(1));
            if(c) {
                c.print("user-chan-msg", "&lt;" + nick + "&gt; " + text);
            } else if (target == me.userInfo.nick) {

                u = findUser(msg.prefix);
                if (! u) {
                    u = new User(msg.prefix);
                    u.createBuffer();
                    addUser(u);
                }

                u.print("user-query-msg", "&lt;" + nick + "&gt; " + text);
            }

        });

        // NAMES (supports userhost-in-names)
        // FIXME: strip the usermode prefix off of the name
        // and do soemthing meaningful with it
        on("irc cmd 353", function(msg) {

            var name = msg.params[2].toLowerCase().substring(1);
            var users = msg.params[3].split(" ");

            var c = findChan(name);

            if(! c)
                return;

            users.forEach(function(nick) {

                u = findUser(nick);
                if(! u) {

                    u = new User(nick);
                    addUser(u);
                }

                if(! u.channels[name])
                    u.addChan(c);

                if(! c.users[c.nick])
                    c.addUser(u);
            });

        });

        on("irc cmd 001", function(msg) {

            me.registered = true;
            sendMsg({ command: "VERSION" });
        });

        on("irc cmd 005", function(msg) {

            msg.params.shift(); // get the name out

            var last = msg.params.indexOf("are supported by this server");

            if (last === -1)
                return;

            msg.params.splice(last, 1);

            msg.params.forEach(function(token) {

                var kv = token.split("=");

                if(! kv[1])
                    kv[1] = true;

                me.isupport[kv[0]] = kv[1];
            });

            parsePrefixes();

        });

        on("irc cmd chghost", function(msg) {

            // sileneces the extremely annoying fake quit/join for changed hosts
            var newuserhost = msg.params[0] + "@" + msg.params[1];
            var olduserhost = msg.prefix.split("!")[0];

            var u = findUser(msg.prefix);

            if (! u)
                return;

            u.user = msg.params[0];
            u.host = msg.params[1];

            appendChanBuffer("--- " + u.nick + " changed host from (" + olduserhost + ") to (" + newuserhost + ")");
        });

        // Return ourselves
        return me;
    }

    return construct();
}
