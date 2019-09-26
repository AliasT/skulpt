var $builtinmodule = function (name) {
    "use strict";

    function getConfiguredTarget() {
        var selector, target;

        selector = (Sk.TurtleGraphics && Sk.TurtleGraphics.target) || "turtle",
        target   = typeof selector === "string" ?
            document.getElementById(selector) :
            selector;
        // ensure that the canvas container is empty
        while (target.firstChild) {
            target.removeChild(target.firstChild);
        }
        return target;
    }

    function generateTurtleModule(_target) {
        var _module              = {},
            _durationSinceRedraw = 0,
            _focus               = true,
            OPTIMAL_FRAME_RATE   = 1000/30,
            SHAPES               = {},
            TURTLE_COUNT         = 0,
            Types                = {},
            _frameRequest,
            _frameRequestTimeout,
            _screenInstance,
            _config,
            _anonymousTurtle,
            _mouseHandler,
            _controlParam = {
                isTracer0: false,
                tracer0Timer: null
            },
            _assets;

        // Ensure that the turtle DOM target has a tabindex
        // so that it can accept keyboard focus and events
        if (!_target.hasAttribute("tabindex")) {
            _target.setAttribute("tabindex", 0);
        }

        Types.FLOAT = function(value) {
            return Sk.builtin.float_(value);
        };
        Types.COLOR = function(value) {
            if (typeof value === "string") {
                return new Sk.builtin.str(value);
            }
            else {
                for(var i = 0; i < 3; i++) {
                    value[i] = Sk.builtin.assk$(value[i]);
                }
                if (value.length === 4) {
                    value[3] = Sk.builtin.float_(value[3]);
                }
                return new Sk.builtin.tuple(value);
            }
        };
        Types.TURTLE_LIST = function(value) {
            var skValues = [];
            for (var i = 0; i < value.length; i++) {
                skValues.push(value[i].skInstance);
            }
            return new Sk.builtin.tuple(skValues);
        };

        SHAPES.arrow    = [[-10,0],[10,0],[0,10]];
        SHAPES.square   = [[ 10,-10],[10,10],[-10,10],[-10, -10]];
        SHAPES.triangle = [[10,-5.77],[0,11.55],[-10,-5.77]];
        SHAPES.classic  = [[0,0],[-5,-9],[0,-7],[5,-9]];
        SHAPES.turtle   = [
            [0,16],[-2,14],[-1,10],[-4,7],[-7,9],[-9,8],[-6,5],[-7,1],[-5,-3],[-8,-6],
            [-6,-8],[-4,-5],[0,-7],[4,-5],[6,-8],[8,-6],[5,-3],[7,1],[6,5],[9,8],[7,9],
            [4,7],[1,10],[2,14]
        ];

        SHAPES.circle = [
            [10,0],[9.51,3.09],[8.09,5.88],[5.88,8.09],[3.09,9.51],[0,10],[-3.09,9.51],
            [-5.88,8.09],[-8.09,5.88],[-9.51,3.09],[-10,0],[-9.51,-3.09],[-8.09,-5.88],
            [-5.88,-8.09],[-3.09,-9.51],[-0,-10],[3.09,-9.51],[5.88,-8.09],[8.09,-5.88],
            [9.51,-3.09]
        ];

        _config = (function() {
            var defaultSetup = {
                    target          : "turtle", // DOM element or id of parent container
                    width           : 400, // if set to 0 it will use the target width
                    height          : 400, // if set to 0 it will use the target height
                    animate         : true, // enabled/disable all animated rendering
                    bufferSize      : 0, // default turtle buffer size
                    allowUndo       : true, // enable ability to use the undo buffer
                    colorMode       :255,
                    assets          : {}
                },
                key;

            if (!Sk.TurtleGraphics) {
                Sk.TurtleGraphics = {};
            }

            for(key in defaultSetup) {
                if (!Sk.TurtleGraphics.hasOwnProperty(key)) {
                    Sk.TurtleGraphics[key] = defaultSetup[key];
                }
            }

            return Sk.TurtleGraphics;
        })();

        function getAsset(name) {
          var assets = _config.assets,
              asset  = (typeof assets === "function") ? assets(name) : assets[name];
          if (typeof asset === "string") {
              return new Promise(function(resolve, reject) {
                  var img = new Image();
                  img.onload = function() {
                      _config.assets[name] = this;
                      resolve(img);
                  };
                  img.onerror = function() {
                      reject(new Error("Missing asset: " + asset));
                  }
                  img.src = asset;
              });
          }
          return new InstantPromise(undefined, asset);
      }


        // InstantPromise is a workaround to allow usage of the clean promise-style
        // then/catch syntax but to instantly call resolve the then/catch chain so we
        // can avoid creating Suspensions in unnecessary cases.  This is desirable
        // because Suspensions have a fairly large negative impact on overall
        // performance.  These 'instant promises' come into play when a tracer()
        // call is made with a value other than 1.  When tracer is 0 or greater than 1
        // , we can bypass the creation of a Suspension and proceed to the next line of
        // code immediately if the current line is not going to incur involve a screen
        // update. We determine if a real promise or InstantPromise is necessary by
        // checking FrameManager.willRenderNext()
        function InstantPromise() {
            this.lastResult = undefined;
            this.lastError  = undefined;
        }

        InstantPromise.prototype.then = function(cb) {
            if (this.lastError) {
                return this;
            }

            try {
             this.lastResult = cb(this.lastResult);
            } catch(e) {
                this.lastResult = undefined;
                this.lastError  = e;
            }

            return this.lastResult instanceof Promise ? this.lastResult : this;
        };

        InstantPromise.prototype.catch = function(cb) {
            if (this.lastError) {
                try {
                    this.lastResult = cb(this.lastError);
                    this.lastError  = undefined;
                } catch(e) {
                    this.lastResult = undefined;
                    this.lastError = e;
                }
            }

            return this.lastResult instanceof Promise ? this.lastResult : this;
        };

        /** 事件串行执行器
         * @param isExecuting 是否有事件正在执行
         * @param eventQueue 事件队列，按照添加顺序依次执行
        */
        function EventSerialExecutor() {
            this.isExecuting = false;
            this.eventQueue = [];
        }
        /** 向事件队列中加入一个事件 */
        EventSerialExecutor.prototype.addEvent = function addEvent(manager, args) {
            var self = this;
            if(this.isExecuting) {
                this.eventQueue.push([manager, args])
                return new Promise(function(resolve) {
                    resolve(self.isExecuting)
                });
            }

            return this.execute(manager, args)
        }

        /** 执行事件，执行完毕后，从事件队列头中取出一个事件递归执行，如果队列为空，停止 */
        EventSerialExecutor.prototype.execute = function execute(manager, args) {
            var self = this;
            this.isExecuting = true;

            var promises = (manager._handlers || []).map(handler => {
                return handler.apply({}, args);
            })

            return Promise.all(promises).then(function() {
                if(self.eventQueue.length > 0) {
                    self.execute.apply(self, self.eventQueue.shift())
                    return false
                } else {
                    self.isExecuting = false;
                    return true
                }
            })
        }

        function FrameManager() {
            this.reset();
        }

        var _frameManager;
        function getFrameManager() {
            if (!_frameManager) {
                _frameManager = new FrameManager();
            }
            return _frameManager;
        }

        (function(proto) {
            var browserFrame;
            (function(frame) {
                if (frame) {
                    browserFrame = function(method) {
                        return (_frameRequest = frame(method));
                    };
                }
            })(window.requestAnimationFrame || window.mozRequestAnimationFrame);

            /**
             * 获取执行动画的方法
             * @param {number} delay 延迟值
             * _config.animate 设置无动画，立刻执行 TODO: 是否可以用于trace(0)
             * browserFrame 设置无延迟，requestAnimationFrame(下一次浏览器重绘)执行
             * OPTIMAL_FRAME_RATE，约30ms 否则设置定时器，delay | OPTIMAL_FRAME_RATE后执行
             *
             */
            function animationFrame(delay) {
                if (!_config.animate) {
                    return function(method) {
                        method();
                    };
                }

                if (!delay && browserFrame) {
                    return browserFrame;
                }

                return function(method) {
                    _frameRequestTimeout = window.setTimeout(
                        method,
                        delay || OPTIMAL_FRAME_RATE
                    );
                     return _frameRequestTimeout;
                };
            }

            proto.willRenderNext = function() {
                return !!(this._buffer && this._frameCount+1 === this.frameBuffer());
            };

            proto.turtles = function() {
                return this._turtles;
            };

            proto.addTurtle = function(turtle) {
                this._turtles.push(turtle);
            };

            proto.reset = function() {
                if (this._turtles) {
                    for(var i = this._turtles.length; --i >= 0;) {
                        this._turtles[i].reset();
                    }
                }
                this._turtles        = [];
                this._frames         = [];
                this._frameCount     = 0;
                this._buffer         = 1;
                this._rate           = 0;
                this._animationFrame = animationFrame();
            };


            proto.resetAnimationFrame = function() {
                this._animationFrame = animationFrame();
                return this;
            }

            proto.addFrame = function(method, countAsFrame) {
                var instant = false;

                if (countAsFrame) {
                    this._frameCount += 1;
                }

                this.frames().push(method);

                instant = (
                    !_config.animate ||
                    (this._buffer && this._frameCount === this.frameBuffer())
                );
                if(_controlParam.isTracer0) {
                    _controlParam.tracer0Timer && window.clearTimeout(_controlParam.tracer0Timer)
                    instant = false;
                    _controlParam.tracer0Timer = setTimeout(function() {
                        this.update()
                    }.bind(this), 100)
                }

                return instant ? this.update() : new InstantPromise();
            };

            proto.frames = function() {
                return this._frames;
            };

            /**
             * 设置/获取this._buffer
             * @param {number} buffer frame's buffer size
             */
            proto.frameBuffer = function(buffer) {
                if (typeof buffer === "number") {
                    this._buffer = buffer | 0;
                    if (buffer && buffer <= this._frameCount) {
                        return this.update();
                    }
                }
                return this._buffer;
            };

            proto.refreshInterval = function(rate) {
                if (typeof rate === "number") {
                    this._rate = rate | 0;
                    this._animationFrame = animationFrame(rate);
                }
                return this._rate;
            };

            proto.update = function() {
                return (this._frames && this._frames.length) ?
                    this.requestAnimationFrame() :
                    new InstantPromise();
            };

            proto.requestAnimationFrame = function() {
                var frames         = this._frames,
                    animationFrame = this._animationFrame,
                    turtles        = this._turtles,
                    sprites        = getScreen().spriteLayer(),
                    turtle, i;

                this._frames     = [];
                this._frameCount = 0;

                return new Promise(function(resolve) {
                    animationFrame(function paint() {
                        for (i = 0; i < frames.length; i++) {
                            if (frames[i]) {
                                frames[i]();
                            }
                        }
                        clearLayer(sprites);
                        for (i = 0; i < turtles.length; i++) {
                            turtle = turtles[i];
                            if (turtle.getState().shown) {
                                drawTurtle(turtle.getState(), sprites);
                            }
                        }
                        resolve();
                    });
                });
            };
        })(FrameManager.prototype);

        function MouseHandler() {
            var self = this;

            this._target   = getTarget();
            this._managerIndex = -1;
            this._managers = {};
            this._handlers = {
                mousedown : function(e) {
                    self.onEvent("mousedown", e);
                },
                mouseup : function(e) {
                    self.onEvent("mouseup", e);
                },
                mousemove : function(e) {
                    self.onEvent("mousemove", e);
                }
            };
            for (var key in this._handlers) {
                this._target.addEventListener(key, this._handlers[key]);
            }

            this._handlers['drag'] = new DragHandler(self._managers);
        }

        (function(proto) {
            proto.onEvent = function(type, e) {
                var managers     = this._managers[type],
                    moveManagers = this._managers["mousemove"],
                    moveManagerIndex = this._managerIndex,
                    computed     = false,
                    x, y, localX, localY, i;

                function computeCoordinates() {
                    if (computed) return;
                    var world = getScreen();
                    var rect  = world.spriteLayer().canvas.getBoundingClientRect();
                    x         = e.clientX - rect.left | 0;
                    y         = e.clientY - rect.top  | 0;
                    localX    = x * world.xScale + world.llx;
                    localY    = y * world.yScale + world.ury;
                    computed = true;
                }
                if ((type === "mousedown" || type === "mouseup") && moveManagers && moveManagers.length) {
                    computeCoordinates();
                    for (i = moveManagers.length; --i >= 0;) {
                        if (moveManagers[i].test(x, y, localX, localY)) {
                            if (type == "mousedown") {
                              this._managerIndex = i;
                            }
                            moveManagers[i].canMove(type === "mousedown");
                        }
                    }
                    if (type === "mouseup") {
                        this._managerIndex = -1;
                    }
                }
                if (managers && managers.length) {
                    computeCoordinates();
                    for (i = managers.length; --i >= 0;) {
                        if (type === "mousemove") {
                            if (managers[i].canMove() && i == moveManagerIndex) {
                                managers[i].trigger([localX, localY]);
                            }
                            continue;
                        }
                        if (managers[i].test(x, y, localX, localY)) {
                            managers[i]._serialExecutor.addEvent(managers[i], [localX, localY])
                        }
                    }
                }
            };

            proto.reset = function() {
                this._managers = {};
            };

            proto.addManager = function(type, manager) {
                if (!this._managers[type]) {
                    this._managers[type] = [];
                }

                this._managers[type].push(manager);
            };

        })(MouseHandler.prototype);

        function DragHandler(managers) {
            var self = this;

            this.isMouseDown = false;
            this.isMouseDrag = false;
            this.isMouseUp = true;

            this._managers = managers;

            this._target   = getTarget();
            this._eventManagers = {};
            this._target.addEventListener('mousedown', self.onMouseDown.bind(self)
            );
        }

        (function(proto) {
            proto.onMouseDown = function(e) {
                var self = this;

                /**
                 * 将事件在屏幕上发生的坐标转换为事件在sprite画布上的坐标（x & y）、sprite画布上相对于canvas坐标系的坐标(localX & localY)
                 */
                function computeCoordinates(e) {
                    var world = getScreen();
                    var rect  = world.spriteLayer().canvas.getBoundingClientRect();
                    x         = e.clientX - rect.left | 0;
                    y         = e.clientY - rect.top  | 0;
                    localX    = x * world.xScale + world.llx;
                    localY    = y * world.yScale + world.ury;
                }

                function onMouseUp(e) {
                    proto.isMouseUp = true;
                    proto.isMouseDrag = false;
                    if(!proto.isMouseDrag) {
                        return;
                    }

                    dragManagers.forEach(function(dragManager) {
                        if(!dragManager.canMove()) {
                            return;
                        }
                        dragManager.canMove(false)
                        getFrameManager().update()
                    })

                    self._target.removeEventListener('mousemove', onMouseMove);
                    document.removeEventListener('mouseup', onMouseUp);
                    self._target.removeEventListener('mousedown', proto.onMouseDown);
                }

                function onMouseMove(e) {
                    proto.isMouseDrag = true;
                    if(proto.isMouseUp) {
                        proto.isMouseDrag = false;
                        return;
                    }

                    dragManagers.forEach(function(dragManager) {
                        if(!proto.isMouseUp && !dragManager.canMove()) {
                            return;
                        }

                        computeCoordinates(e)
                        dragManager._serialExecutor.addEvent(dragManager, [localX, localY]).then(function(isDone) {
                            if(isDone && proto.isMouseUp) {
                                getFrameManager().update()
                            }
                        })
                    })
                }

                var dragManagers = this._managers["drag"] || [],
                    x, y, localX, localY, i;
                proto.isMouseDown = true;
                proto.isMouseUp = false;

                document.addEventListener('mouseup', onMouseUp)
                this._target.addEventListener('mousemove', onMouseMove)

                computeCoordinates(e);

                dragManagers.forEach(function(dragManager) {
                    var canMove = Boolean(dragManager.test(x, y, localX, localY))
                    dragManager.canMove(canMove)
                })
            }
        })(DragHandler.prototype);

        function EventManager(type, target) {
            this._type     = type;
            this._target   = target;
            this._handlers = undefined;
            this._serialExecutor = new EventSerialExecutor()
            getMouseHandler().addManager(type, this);
        }

        (function(proto) {
            proto.reset = function() {
                this._handlers = undefined;
            };

            /**
             * 设置canMove值为value，或者获取this._target.hitTest.hit
             */
            proto.canMove = function(value) {
                var ret = false;
                if (!this._target) {
                    ret = false;
                } else if (value !== undefined) {
                    this._target.canMove = value;
                    ret = value;
                } else {
                    ret = this._target.canMove;
                }

                return ret;
            };

            proto.test = function(x, y, localX, localY) {
                return this._target && this._target.hitTest ?
                    this._target.hitTest(x, y, localX, localY) :
                    !!this._target;
            };

            proto.trigger = function(args, afterTrigger) {
                var handlers = this._handlers,
                    i;

                if (handlers && handlers.length) {
                    for (i = 0; i < handlers.length; i++) {
                        handlers[i].apply({
                            callAfter: afterTrigger
                        }, args);
                    }
                }
            };

            proto.addHandler = function(handler, add) {
                var handlers = this._handlers;

                if (!add && handlers && handlers.length) {
                    // remove all existing handlers
                    while (handlers.shift()) {/* noop */}
                }

                if (typeof handler !== "function") {
                    if (handlers && !handlers.length) {
                        this.reset();
                    }
                    return;
                }

                if (!handlers) {
                    handlers = this._handlers = [];
                }

                handlers.push(handler);
            };
        })(EventManager.prototype);

        function Turtle() {
            getFrameManager().addTurtle(this);
            this._screen = getScreen();
            this._managers = {};
            this.reset();
        }

        Turtle.RADIANS = 2 * Math.PI;

        (function(proto) {
            proto.hitTest = function(mouseX, mouseY, localX, localY) {
                var context = getScreen().hitTestLayer();
                clearLayer(context);
                drawTurtle(this.getState(), context);
                var pixel = context.getImageData(mouseX,mouseY,1,1).data;
                return pixel[3] ||pixel[0] || pixel[1] || pixel[2];
            };

            /**
             * 在帧序列中追加一组新帧，到执行时刻，先执行method，再执行stateChanges
             * @param {function} method turtle要进行的动作
             * @param {boolean} countAsFrame 是否作为一个帧
             * @param {state} stateChanges turtle要改变的状态
             */
            proto.addUpdate = function(method, countAsFrame, stateChanges) {
                var self  = this,
                    state = this.getState(),
                    args  = Array.prototype.slice.call(arguments, stateChanges ? 2 : 3);

                return getFrameManager().addFrame(function() {
                    if (method) {
                        method.apply(state, args);
                    }
                    if (stateChanges) {
                        for(var key in stateChanges) {
                            state[key] = stateChanges[key];
                        }
                    }
                }, countAsFrame);
            };

            proto.getState = function() {
                var self = this;

                if (!this._state) {
                    this._state = {
                        x       : this._x,
                        y       : this._y,
                        angle   : this._angle,
                        radians : this._radians,
                        shape   : this._shape,
                        color   : this._color,
                        fill    : this._fill,
                        filling : this._filling,
                        size    : this._size,
                        speed   : this._computed_speed,
                        down    : this._down,
                        shown   : this._shown,
                        wid     : this._shape_wid,
                        len     : this._shape_len,
                        outline : this._shape_outline,
                        context : function() {
                            return self.getPaper();
                        }
                    };
                }
                return this._state;
            };

            proto.translate = function(startX, startY, dx, dy, beginPath, isCircle) {
                var self = this;
                return translate(this, startX, startY, dx, dy, beginPath, isCircle)
                    .then(function(coords) {
                        self._x = coords[0];
                        self._y = coords[1];
                    });
            };

            proto.rotate = function(startAngle, delta, isCircle) {
                var self = this;
                return rotate(this, startAngle, delta, isCircle)
                    .then(function(heading) {
                        self._angle   = heading.angle;
                        self._radians = heading.radians;
                    });
            };

            proto.queueMoveBy = function(startX, startY, theta, distance) {
                var dx = Math.cos(theta) * distance,
                    dy = Math.sin(theta) * distance;

                return this.translate(startX, startY, dx, dy, true);
            };

            proto.queueTurnTo = function(startAngle, endAngle) {
                endAngle = endAngle % this._fullCircle;
                if (endAngle < 0) {
                    endAngle += this._fullCircle;
                }
                return this.rotate(startAngle, endAngle - startAngle);
            };

            proto.getManager = function(type) {
                if (!this._managers[type]) {
                    this._managers[type] = new EventManager(type, this);
                }
                return this._managers[type];
            };

            proto.getPaper = function() {
                return this._paper || (this._paper = createLayer(2));
            };

            proto.reset = function() {
                this._x          = 0;
                this._y          = 0;
                this._radians    = 0;
                this._angle      = 0;
                this._shown      = true;
                this._down       = true;
                this._color      = "black";
                this._fill       = "black";
                this._shape      = "classic";
                this._size       = 1;
                this._filling    = false;
                this._undoBuffer = [];
                this._speed      = 3;
                this._computed_speed = 5;
                this._state      = undefined;
                this._shape_wid  = 1;
                this._shape_len  = 1;
                this._shape_outline = 1;

                for(var key in this._managers) {
                    this._managers[key].reset();
                }

                this._isRadians  = false;
                this._fullCircle = 360;
                this._bufferSize = typeof _config.bufferSize === "number" ?
                    _config.bufferSize :
                    0;

                removeLayer(this._paper);
                this._paper = undefined;
            };

            proto.$degrees = function(fullCircle) {
                fullCircle = (typeof fullCircle === "number") ?
                    Math.abs(fullCircle) :
                    360;

                this._isRadians  = false;
                if (!fullCircle || !this._fullCircle) {
                    this._angle = this._radians = 0;
                }
                else {
                    this._angle = this._angle / this._fullCircle * fullCircle;
                }
                this._fullCircle = fullCircle;
                return this.addUpdate(
                    undefined,
                    false,
                    {angle:this._angle, radians: this._radians}
                );
            };
            proto.$degrees.minArgs     = 0;
            proto.$degrees.keywordArgs = ["fullcircle"];
            proto.$degrees.returnType  = Types.FLOAT;

            proto.$radians = function() {
                if (!this._isRadians) {
                    this._isRadians     = true;
                    this._angle = this._radians;
                    this._fullCircle = Turtle.RADIANS;
                }

                return this._angle;
            };
            proto.$radians.returnType = Types.FLOAT;

            proto.$position = proto.$pos = function() {
                return [this.$xcor(), this.$ycor()];
            };
            proto.$position.returnType = function(value) {
                return new Sk.builtin.tuple([
                        Sk.builtin.float_(value[0]),
                        Sk.builtin.float_(value[1])
                ]);
            };

            proto.$towards = function(x,y) {
                var coords  = getCoordinates(x,y),
                    radians = Math.PI + Math.atan2(this._y - coords.y, this._x - coords.x),
                    angle   = radians * (this._fullCircle / Turtle.RADIANS);

                return angle;
            };
            proto.$towards.minArgs    = 1;
            proto.$towards.returnType = Types.FLOAT;

            proto.$distance = function(x,y) {
                var coords = getCoordinates(x,y),
                    dx     = coords.x - this._x,
                    dy     = coords.y - this._y;

                return Math.sqrt(dx * dx + dy * dy);
            };
            proto.$distance.minArgs    = 1;
            proto.$distance.returnType = Types.FLOAT;

            proto.$heading = function() {
                return Math.abs(this._angle) < 1e-13 ? 0 : this._angle;
            };
            proto.$heading.returnType = Types.FLOAT;

            proto.$xcor = function() {
                return Math.abs(this._x) < 1e-13 ? 0 : this._x;
            };
            proto.$xcor.returnType = Types.FLOAT;

            proto.$ycor = function() {
                return Math.abs(this._y) < 1e-13 ? 0 : this._y;
            };
            proto.$ycor.returnType = Types.FLOAT;

            proto.$forward = proto.$fd = function(distance) {
                pushUndo(this);
                return this.queueMoveBy(this._x, this._y, this._radians, distance);
            };

            proto.$undo = function() {
                popUndo(this);
            };

            proto.$undobufferentries = function() {
                return this._undoBuffer.length;
            };

            proto.$setundobuffer = function(size) {
                this._bufferSize = typeof size === "number" ?
                    Math.min(Math.abs(size), 1000) :
                    0;
            };

            proto.$backward = proto.$back = proto.$bk = function(distance) {
                pushUndo(this);
                return this.queueMoveBy(this._x, this._y, this._radians, -distance);
            };

            proto.$goto_$rw$ = proto.$setpos = proto.$setposition = function(x,y) {
                var coords = getCoordinates(x,y);

                pushUndo(this);

                return this.translate(
                    this._x, this._y,
                    coords.x - this._x, coords.y - this._y,
                    true
                );
            };
            proto.$goto_$rw$.minArgs = 1;

            proto.$setx = function(x) {
                return this.translate(this._x, this._y, x - this._x, 0, true);
            };

            proto.$sety = function(y) {
                return this.translate(this._x, this._y, 0, y - this._y, true);
            };

            proto.$home = function() {
                var self  = this,
                    angle = this._angle;

                pushUndo(this);
                return self.translate(this._x, this._y, -this._x, -this._y, true)
                    .then(function(position) {
                        return self.queueTurnTo(angle, 0);
                    })
                    .then(function(heading) {
                        return undefined;
                    });
            };

            proto.$right = proto.$rt = function(angle) {
                pushUndo(this);
                return this.rotate(this._angle, -angle);
            };

            proto.$left = proto.$lt = function(angle) {
                pushUndo(this);
                return this.rotate(this._angle, angle);
            };

            proto.$setheading = proto.$seth = function(angle) {
                pushUndo(this);
                return this.queueTurnTo(this._angle, angle);
            };

            function circleRotate(turtle, angle, radians) {
                return function() {
                    return turtle.addUpdate(
                        undefined,
                        false,{angle:angle, radians:radians}
                    );
                };
            }

            function circleSegment(turtle, x, y, dx, dy, beginPath) {
                return function() {
                    return turtle.translate(x, y, dx, dy, beginPath, true);
                };
            }

            proto.$circle = function(radius, extent, steps) {
                var self      = this,
                    x         = this._x,
                    y         = this._y,
                    angle     = this._angle,
                    heading   = {},
                    states    = [],
                    scale     = 1/getScreen().lineScale,
                    beginPath = true,
                    endAngle, frac, w, w2, l, i, dx, dy, promise;

                pushUndo(this);

                if (extent === undefined) {
                    extent = self._fullCircle;
                }

                if (steps === undefined) {
                    frac  = Math.abs(extent)/self._fullCircle;
                    steps = 1 + ((Math.min(11+Math.abs(radius*scale)/6, 59)*frac) | 0);
                }
                w  = extent / steps;
                w2 = 0.5 * w;
                l  = 2 * radius * Math.sin(w*Math.PI/self._fullCircle);

                if (radius < 0) {
                    l = -l;
                    w = -w;
                    w2 = -w2;
                    endAngle = angle - extent;
                }
                else {
                    endAngle = angle + extent;
                }

                promise = getFrameManager().willRenderNext() ? Promise.resolve() : new InstantPromise();

                angle += w2;

                for(i = 0; i < steps; i++) {
                    calculateHeading(self, angle + w * i, heading);
                    dx = Math.cos(heading.radians) * l;
                    dy = Math.sin(heading.radians) * l;
                    promise = promise
                        .then(circleRotate(self, heading.angle, heading.radians))
                        .then(circleSegment(self, x, y, dx, dy, beginPath));
                    x += dx;
                    y += dy;
                    beginPath = false;
                }

                promise = promise.then(function() {
                    calculateHeading(self, endAngle, heading);
                    self._angle   = heading.angle;
                    self._radians = heading.radians;
                    return self.addUpdate(undefined, true, heading);
                });

                return promise;
            };
            proto.$circle.keywordArgs = ["extent", "steps"];
            proto.$circle.minArgs     = 1;

            proto.$penup = proto.$up = proto.$pu = function() {
                this._down = false;
                return this.addUpdate(undefined, false, {down:false});
            };

            proto.$pendown = proto.$down = proto.$pd = function() {
                this._down = true;
                return this.addUpdate(undefined, false, {down:true});
            };

            proto.$isdown = function() {
                return this._down;
            };

            proto.$speed = function(speed) {
                var speeds = {
                    fastest: 0,
                    fast: 10,
                    normal: 6,
                    slow: 3,
                    slowest: 1,
                }

                if(!speed) {
                   return this._speed;
                }

                if(speed in speeds) {
                    speed = speeds[speed]
                } else if(0.5 < speed && speed < 10.5) {
                    speed = Math.round(Number(speed));
                } else {
                    speed = 0
                }

                this._speed          = Math.max(0, Math.min(1000, speed));
                this._computed_speed = Math.max(0, speed * 4 - 1); //TODO: why * 2 - 1

                return this.addUpdate(undefined, false, {speed:this._computed_speed});
            };
            proto.$speed.minArgs = 0;
            proto.$speed.keywordArgs = ["speed"];

            proto.$pencolor = function(r,g,b,a) {
                var color;

                if (arguments.length) {
                    this._color = createColor(r,g,b,a);
                    return this.addUpdate(undefined, this._shown, {color : this._color});
                }

                return hexToRGB(this._color);
            };
            proto.$pencolor.minArgs = 0;
            proto.$pencolor.returnType = Types.COLOR;

            proto.$fillcolor = function(r,g,b,a) {
                var color;

                if (arguments.length) {
                    this._fill = createColor(r,g,b,a);
                    return this.addUpdate(undefined, this._shown, {fill : this._fill});
                }

                return hexToRGB(this._fill);
            };
            proto.$fillcolor.minArgs = 0;
            proto.$fillcolor.returnType = Types.COLOR;

            proto.$color = function(color, fill, b, a) {
                if (arguments.length) {
                    if (arguments.length === 1 || arguments.length >= 3) {
                        this._color = createColor(color, fill, b, a);
                        this._fill  = this._color;
                    }
                    else {
                        this._color = createColor(color);
                        this._fill  = createColor(fill);
                    }
                    return this.addUpdate(undefined, this._shown, {
                        color : this._color,
                        fill  : this._fill
                    });
                }
                return [this.$pencolor(), this.$fillcolor()];
            };
            proto.$color.minArgs = 0;
            proto.$color.returnType = function(value) {
                return new Sk.builtin.tuple([
                    Types.COLOR(value[0]),
                    Types.COLOR(value[1])
                ]);
            };

            proto.$fill = function(flag) {
                var self = this;

                if (flag !== undefined) {
                    flag = !!flag;
                    if (flag === this._filling) return;
                    this._filling = flag;
                    if (flag) {
                        pushUndo(this);
                        return this.addUpdate(undefined, false, {
                            filling      : true,
                            fillBuffer : [{x : this._x, y : this._y}]
                        });
                    }
                    else {
                        pushUndo(this);
                        return this.addUpdate(
                            function() {
                                this.fillBuffer.push(this);
                                drawFill.call(this);
                            },
                            true,
                            {
                                filling      : false,
                                fillBuffer : undefined
                            }
                        );
                    }
                }

                return this._filling;
            };
            proto.$fill.minArgs = 0;

            proto.$filling = function() {
              return this._filling;
            };

            proto.$begin_fill = function() {
                return this.$fill(true);
            };

            proto.$end_fill = function() {
                return this.$fill(false);
            };

            proto.$stamp = function() {
                pushUndo(this);
                return this.addUpdate(function() {
                    drawTurtle(this, this.context());
                }, true);
            };

            proto.$dot = function(size, color, g, b, a) {
                pushUndo(this);
                size = Sk.builtin.asnum$(size);
                size = (typeof size === "number") ?
                    Math.max(1, Math.abs(size) | 0) :
                    Math.max(this._size + 4, this._size * 2);

                color = (color !== undefined) ?
                    createColor(color, g, b, a) :
                    this._color;

                return this.addUpdate(drawDot, true, undefined, size, color);
            };

            proto.$write = function(message,move,align,font) {
                var self = this,
                    promise, face, size, type, width;

                pushUndo(this);

                message = String(message);

                if (font && font.constructor === Array) {
                    face = typeof font[0] === "string" ? font[0] : "Arial";
                    size = String(font[1] || "12pt");
                    type = typeof font[2] === "string" ? font[2] : "normal";
                    if (/^\d+$/.test(size)) {
                        size += "pt";
                    }

                    font = [type, size, face].join(" ");
                }

                if (!align) {
                    align = "left";
                }

                promise = this.addUpdate(
                    drawText, true, undefined, message, align, font
                );

                if (move && (align === "left" || align === "center")) {
                    width = measureText(message, font);
                    if (align === "center") {
                        width = width/2;
                    }
                    promise = promise.then(function() {
                        var state = self.getState();
                        return self.translate(state.x, state.y, width, 0, true);
                    });
                }

                return promise;
            };
            proto.$write.keywordArgs = ["move","align","font"];
            proto.$write.minArgs     = 1;

            proto.$pensize = proto.$width = function(size) {
                if (arguments.length) {
                    this._size = size;
                    return this.addUpdate(undefined, this._shown, {size : size});
                }

                return this._size;
            };
            proto.$pensize.minArgs = proto.$width.minArgs = 0;
            proto.$pensize.keywordArgs = proto.$width.keywordArgs = ["width"];

            proto.$showturtle = proto.$st = function() {
                this._shown = true;
                return this.addUpdate(undefined, true, {shown : true});
            };

            proto.$hideturtle = proto.$ht = function() {
                this._shown = false;
                return this.addUpdate(undefined, true, {shown : false});
            };

            proto.$isvisible = function() {
                return this._shown;
            };

            proto.$shape = function(shape) {
                if (shape && SHAPES[shape]) {
                    this._shape = shape;
                    return this.addUpdate(undefined, this._shown, {shape : shape});
                }

                return this._shape;
            };
            proto.$shape.minArgs     = 0;
            proto.$shape.keywordArgs = ["name"];


            proto.$shapesize = function(wid, len, outline) {
              if (arguments.length) {
                  if(wid !== undefined){
                    this._shape_wid = wid;
                        if(len === undefined) {
                            this._shape_len = wid;
                        }
                  }
                  if(len !== undefined){
                    this._shape_len = len;
                  }
                  if(outline !== undefined){
                    this._shape_outline = outline;
                  }
                  return this.addUpdate(undefined, this._shown, { wid : this._shape_wid, len : this._shape_len, outline : this._shape_outline});
              }
              return [this._shape_wid, this._shape_len, this._shape_outline];
            };
            proto.$shapesize.minArgs = 0;
            proto.$shapesize.keywordArgs = ["stretch_wid", "stretch_len", "outline"];
            proto.$shapesize.returnType = function(value) {
              return new Sk.builtin.tuple([value[0], value[1], value[2]]);
            }

            proto.$turtlesize = function(wid, len, outline) {
              if (arguments.length) {
                  if(wid !== undefined){
                    this._shape_wid = wid;
                  }
                  if(len !== undefined){
                    this._shape_len = len;
                  }
                  if(outline !== undefined){
                    this._shape_outline = outline;
                  }
                  return this.addUpdate(undefined, this._shown, { wid : this._shape_wid, len : this._shape_len, outline : this._shape_outline});
              }
              return [this._shape_wid, this._shape_len, this._shape_outline];
            };
            proto.$turtlesize.minArgs = 0;
            proto.$turtlesize.keywordArgs = ["stretch_wid", "stretch_len", "outline"];
            proto.$turtlesize.returnType = function(value) {
              return new Sk.builtin.tuple([value[0], value[1], value[2]]);
            };

            proto.$window_width = function() {
                return this._screen.$window_width();
            };

            proto.$window_height = function() {
                return this._screen.$window_height();
            };

            proto.$tracer = function(n, delay) {
                return this._screen.$tracer(n, delay);
            };
            proto.$tracer.minArgs     = 0;
            proto.$tracer.keywordArgs = ["n", "delay"];

            proto.$update = function() {
                return this._screen.$update();
            };

            proto.$delay = function(delay) {
                return this._screen.$delay(delay);
            };
            proto.$delay.minArgs     = 0;
            proto.$delay.keywordArgs = ["delay"];

            proto.$reset = function() {
                this.reset();
                return this.$clear();
            };

            proto.$mainloop = proto.$done = function() {
                return this._screen.$mainloop();
            };

            proto.$clear = function() {
                return this.addUpdate(function() {
                    clearLayer(this.context());
                }, true);
            };
            proto.$dot.minArgs = 0;

            proto.$onclick = function(method,btn,add) {
                this.getManager("mousedown").addHandler(method, add);
            };
            proto.$onclick.minArgs = 1;
            proto.$onclick.keywordArgs = ["btn","add"];

            proto.$onrelease = function(method,btn,add) {
                this.getManager("mouseup").addHandler(method, add);
            };
            proto.$onrelease.minArgs = 1;
            proto.$onrelease.keywordArgs = ["btn","add"];

            proto.$ondrag = function(method,btn,add) {
                this.getManager("drag").addHandler(method, add);
            };
            proto.$ondrag.minArgs = 1;
            proto.$ondrag.keywordArgs = ["btn","add"];

            proto.$getscreen = function() {
                return _module.Screen();
            };
            proto.$getscreen.isSk = true;

            proto.$clone = function() {

                var newTurtleInstance = Sk.misceval.callsimOrSuspend(_module.Turtle);

                // All the properties that are in getState()
                newTurtleInstance.instance._x = this._x;
                newTurtleInstance.instance._y = this._y;
                newTurtleInstance.instance._angle = this._angle;
                newTurtleInstance.instance._radians = this._radians;
                newTurtleInstance.instance._shape = this._shape;
                newTurtleInstance.instance._color = this._color;
                newTurtleInstance.instance._fill = this._fill;
                newTurtleInstance.instance._filling = this._filling;
                newTurtleInstance.instance._size = this._size;
                newTurtleInstance.instance._computed_speed = this._computed_speed;
                newTurtleInstance.instance._down = this._down;
                newTurtleInstance.instance._shown = this._shown;
                newTurtleInstance.instance._shape_len = this._shape_len;
                newTurtleInstance.instance._shape_wid = this._shape_wid;
                newTurtleInstance.instance._shape_outline = this._shape_outline;
                // Other properties to copy
                newTurtleInstance.instance._isRadians = this._isRadians;
                newTurtleInstance.instance._fullCircle = this._fullCircle;
                newTurtleInstance.instance._bufferSize = this._bufferSize;
                newTurtleInstance.instance._undoBuffer = this._undoBuffer;


                newTurtleInstance._clonedFrom = this;

                return newTurtleInstance;
            };
            proto.$clone.returnType = function(value) {
                // When I return the instance here, I'm not sure if it ends up with the right "Turtle" python type.
                return value
            };

            proto.$getturtle = proto.$getpen = function() {
                return this.skInstance;
            };

            proto.$pen = function(pen, shown, pendown, pencolor, fillcolor, pensize, speed, outline) {
              if (arguments.length) {
                  if(pen !== undefined){
                    this._shown = pen.shown;
                    this._down = pen.down;
                    this._color = pen.color;
                    this._fill = pen.fill;
                    this._size = pen.size;
                    this._computed_speed = pen.speed;
                  }

                  if(shown !== undefined){
                    this._shown = shown;
                  }
                  if(pendown !== undefined){
                    this._down = pendown;
                  }
                  if(pencolor !== undefined){
                    this._color = pencolor;
                  }
                  if(fillcolor !== undefined){
                    this._fill = fillcolor;
                  }
                  if(pensize !== undefined){
                    this._size = pensize;
                  }
                  if(speed !== undefined){
                    this._computed_speed = speed;
                  }
                  if(outline !== undefined){
                    this._shape_outline = outline;
                  }
                  return this.addUpdate(undefined, this._shown,{
                      shown : this._shown,
                      down : this._down,
                      color : this._color,
                      fill : this._fill,
                      size : this._size,
                      speed : this._computed_speed,
                      outline : this._shape_outline
                    });
              }
              var loc_state = this._state;
              delete loc_state['context'];
              return loc_state;
            };
            proto.$pen.minArgs = 0;
            proto.$pen.keywordArgs = ["pen", "shown", "pendown", "pencolor", "fillcolor", "pensize", "speed", "outline"];

            proto.$getturtle.isSk = true;
        })(Turtle.prototype);

        function Screen() {
            var w,h;
            this._frames    = 1;
            this._delay     = undefined;
            this._bgcolor   = "none";
            this._mode      = "standard";
            this._managers  = {};
            this._keyLogger = {};
            this._colorMode = 1.0;  // colormode 1.0 (1.0,0,0) and 255 (255,0,0)defaut 255
            _config.colorMode = this._colorMode;
            if (_config.height && _config.width) {
                w = _config.width/2;
                h = _config.height/2;
            } else {
                w = _config.defaultSetup.width/2;
                h = _config.defaultSetup.height/2;
            }
            this.setUpWorld(-w,-h,w,h);
        }

        (function(proto) {
            proto.spriteLayer = function() {
                return this._sprites || (this._sprites = createLayer(3));
            };

            proto.bgLayer = function() {
                return this._background || (this._background = createLayer(1));
            };

            proto.hitTestLayer = function() {
                return this._hitTest || (this._hitTest = createLayer(0,true));
            };

            proto.getManager = function(type) {
                if (!this._managers[type]) {
                    this._managers[type] = new EventManager(type, this);
                }
                return this._managers[type];
            };

            proto.reset = function() {
                var key;

                this._keyListeners = undefined;

                for (key in this._keyLogger) {
                    window.clearInterval(this._keyLogger[key]);
                    window.clearTimeout(this._keyLogger[key]);
                    delete this._keyLogger[key];
                }

                if (this._keyDownListener) {
                    getTarget().removeEventListener("keydown", this._keyDownListener);
                    this._keyDownListener = undefined;
                }

                if (this._keyUpListener) {
                    getTarget().removeEventListener("keyup", this._keyUpListener);
                    this._keyUpListener = undefined;
                }

                if (this._timer) {
                    window.clearTimeout(this._timer);
                    this._timer = undefined;
                }

                for(key in this._managers) {
                    this._managers[key].reset();
                }

                this._mode = "standard";
                removeLayer(this._sprites);
                this._sprites = undefined;
                removeLayer(this._background);
                this._background = undefined;
            };

            proto.setUpWorld = function(llx, lly, urx, ury) {
                var world = this;

                world.llx       = llx;
                world.lly       = lly;
                world.urx       = urx;
                world.ury       = ury;
                world.xScale    = (urx - llx) / getWidth();
                world.yScale    = -1 * (ury - lly) / getHeight();
                world.lineScale = Math.min(Math.abs(world.xScale), Math.abs(world.yScale));
            };

            proto.$setup = function(width, height, startX, startY) {
                if (isNaN(parseFloat(width))) {
                    width = getWidth();
                }
                if (isNaN(parseFloat(height))) {
                    height = getHeight();
                }

                if (width <= 1) {
                    width = getWidth() * width;
                }
                if (height <= 1) {
                    height = getHeight() * height;
                }

                this._width  = width;
                this._height = height;

                this._xOffset = (startX !== undefined && !isNaN(parseInt(startX))) ?
                    parseInt(startX) :
                    0;

                this._yOffset = (startY !== undefined && !isNaN(parseInt(startY))) ?
                    parseInt(startY) :
                    0;

                if (this._mode === "world") {
                    return this._setworldcoordinates(this.llx, this.lly, this.urx, this.ury);
                }

                return this._setworldcoordinates(-width/2, -height/2, width/2, height/2);
            };
            proto.$setup.minArgs     = 0;
            proto.$setup.keywordArgs = ["width", "height", "startx", "starty"];

            proto.$register_shape = proto.$addshape = function(name, points) {
              if (!points) {
                return getAsset(name).then(function(asset) {
                    SHAPES[name] = asset;
                });
              }
              else {
                SHAPES[name] = points;
              }
            };

            proto.$register_shape.minArgs = 1;
            proto.$addshape.minArgs = 1;

            proto.$getshapes = function() {
                return Object.keys(SHAPES);
            };

            proto.$tracer = function(frames, delay) {
                if (frames !== undefined || delay !== undefined) {
                    if (typeof delay === "number") {
                        this._delay = delay;
                        getFrameManager().refreshInterval(delay);
                    }
                    //support tracer(False)/tracer(True)
                    if (typeof frames === "number" || typeof frames === "boolean") {
                        frames = Number(frames);
                        if(frames === 0) {
                            _controlParam.isTracer0 = true;
                        }
                        this._frames = frames;
                        return getFrameManager().frameBuffer(frames);
                    }

                    return;
                }

                return this._frames;
            };
            proto.$tracer.minArgs = 0;

            proto.$delay = function(delay) {
                if (delay !== undefined) {
                    return this.$tracer(undefined, delay);
                }

                return this._delay === undefined ? OPTIMAL_FRAME_RATE : this._delay;
            };

            proto._setworldcoordinates = function(llx, lly, urx, ury) {
                var world     = this,
                    turtles = getFrameManager().turtles();

                this.setUpWorld(llx, lly, urx, ury);

                if (this._sprites) {
                    applyWorld(this, this._sprites);
                }

                if (this._background) {
                    applyWorld(this, this._background);
                }

                return this.$clear();
            };

            proto.$setworldcoordinates = function(llx, lly, urx, ury) {
                this._mode = "world";
                return this._setworldcoordinates(llx, lly, urx, ury);
            };

            proto.$clear = proto.$clearscreen = function() {
                this.reset();
                return this.$reset();
            };

            proto.$update = function() {
                return getFrameManager().update();
            };

            proto.$reset = proto.$resetscreen = function() {
                var self = this,
                    turtles = getFrameManager().turtles();

                return getFrameManager().addFrame(function() {
                    applyWorld(self, self._sprites);
                    applyWorld(self, self._background);
                    for(var i = 0; i < turtles.length; i++) {
                        turtles[i].reset();
                        applyWorld(self, turtles[i]._paper);
                    }
                }, true);
            };

            proto.$window_width = function() {
                return getWidth();
            };

            proto.$window_height = function() {
                return getHeight();
            };
            proto.$delay.minArgs = 0;

            proto.$turtles = function() {
                return getFrameManager().turtles();
            };
            proto.$turtles.returnType = Types.TURTLE_LIST;

            proto.$bgcolor = function(color, g, b, a) {
                if (arguments.length) {
                    this._bgcolor = createColor(color, g, b, a);
                    clearLayer(this.bgLayer(), this._bgcolor);
                    return;
                }

                return hexToRGB(this._bgcolor);
            };
            proto.$bgcolor.minArgs = 0;
            proto.$bgcolor.returnType = Types.COLOR;

            proto.$bgpic = function(name) {
              var self;
              if (name) {
                  self = this;
                  return getAsset(name).then(function(asset) {
                      clearLayer(self.bgLayer(), undefined, asset);
                  });
              }

              return this._bgpic;
            };
            proto.$bgpic.minArgs = 0;
            proto.$bgpic.co_varnames = ["name"];

            proto.$colormode = function(mode) {
              if (arguments.length) {
                  if(typeof mode == "number") {
                    if(parseInt(mode) == 255) {
                      this._colorMode= 255;
                      _config.colorMode = this._colorMode;
                    }else if (parseInt(mode) == 1) {
                      this._colorMode= 1.0;
                      _config.colorMode = this._colorMode;
                    }
                  }
                  return;
              }
              let fixed = 0;
              if(typeof _config.colorMode == "number") {
                if(parseInt(_config.colorMode) == 255) {
                  fixed = 0;
                }else if (parseInt(_config.colorMode) == 1) {
                  fixed = 1;
                }
              }
              return _config.colorMode.toFixed(fixed);
            };
            proto.$colormode.minArgs = 0;

            // no-op - just defined for consistency with python version
            proto.$mainloop = proto.$done = function() {
                return undefined;
            };

            proto.$bye = function() {
                return Sk.TurtleGraphics.reset();
            };

            proto.$exitonclick = function() {
                this._exitOnClick = true;
                return this.getManager("mousedown").addHandler(function() {
                    resetTurtle();
                }, false);
            };

            proto.$onclick = function(method,btn,add) {
                if (this._exitOnClick) return;
                this.getManager("mousedown").addHandler(method, add);
            };
            proto.$onclick.minArgs = 1;
            proto.$onclick.keywordArgs = ["btn","add"];

            var KEY_MAP = {
                "8"  : /^back(space)?$/i,
                "9"  : /^tab$/i,
                "13" : /^(enter|return)$/i,
                "16" : /^shift$/i,
                "17" : /^(ctrl|control)$/i,
                "18" : /^alt$/i,
                "27" : /^esc(ape)?$/i,
                "32" : /^space$/i,
                "33" : /^page[\s\-]?up$/i,
                "34" : /^page[\s\-]?down$/i,
                "35" : /^end$/i,
                "36" : /^home$/i,
                "37" : /^left([\s\-]?arrow)?$/i,
                "38" : /^up([\s\-]?arrow)?$/i,
                "39" : /^right([\s\-]?arrow)?$/i,
                "40" : /^down([\s\-]?arrow)?$/i,
                "45" : /^insert$/i,
                "46" : /^del(ete)?$/i
            };

            proto._createKeyRepeater = function(key, code) {
                var self = this;
                // set a timeout for 333ms and if key has not yet been
                // released, fire another event and continue firing
                // at a rate of ~20 times per second until key is released
                self._keyLogger[code] = window.setTimeout(function() {
                    // trigger the first repeat after the longer delay
                    self._keyListeners[key]();
                    // set up the repeat interval with the quick delay
                    self._keyLogger[code] = window.setInterval(function() {
                        self._keyListeners[key]();
                    }, 50);
                }, 333);
            };

            proto._createKeyDownListener = function() {
                var self = this;

                if (this._keyDownListener) return;

                this._keyDownListener = function(e) {
                    if (!focusTurtle()) return;

                    var code    = e.charCode || e.keyCode,
                        pressed = String.fromCharCode(code).toLowerCase(),
                        key, inKeyMap;

                    if (self._keyLogger[code]) return;

                    for (key in self._keyListeners) {
                        inKeyMap = (key.length > 1 && KEY_MAP[code] && KEY_MAP[code].test(key));
                        if (key === pressed || inKeyMap) {
                            // trigger the intial keydown handler
                            self._keyListeners[key]();
                            self._createKeyRepeater(key, code);
                            e.preventDefault();
                            break;
                        }
                    }
                };

                getTarget().addEventListener("keydown", this._keyDownListener);
            };

            proto._createKeyUpListener = function() {
                var self = this;

                if (this._keyUpListener) return;

                this._keyUpListener = function(e) {
                    var interval = self._keyLogger[e.charCode || e.keyCode];
                    if (interval !== undefined) {
                        e.preventDefault();
                        window.clearInterval(interval);
                        window.clearTimeout(interval);
                        delete(self._keyLogger[e.charCode || e.keyCode]);
                    }
                };

                getTarget().addEventListener("keyup", this._keyUpListener);
            };

            proto.$listen = function() {
                this._createKeyUpListener();
                this._createKeyDownListener();
            };

            proto.$onkey =  function(method, keyValue) {
                if (typeof keyValue === "function") {
                    var temp = method;
                    method   = keyValue;
                    keyValue = temp;
                }

                keyValue = String(keyValue).toLowerCase();

                if (method && typeof method === "function") {
                    if (!this._keyListeners) this._keyListeners = {};
                    this._keyListeners[keyValue] = method;
                }
                else {
                    delete this._keyListeners[keyValue];
                }
            };

            proto.$onkeypress = proto.$onkey;

            proto.$onscreenclick = function(method,btn,add) {
                this.getManager("mousedown").addHandler(method, add);
            };
            proto.$onscreenclick.minArgs = 1;
            proto.$onscreenclick.keywordArgs = ["btn","add"];

            proto.$ontimer = function(method, interval) {
                if (this._timer) {
                    window.clearTimeout(this._timer);
                    if(window.TurtleTimers != undefined && window.TurtleTimers.length > 0) {
                      var index = window.TurtleTimers.indexOf(this._timer);
                      if (index > -1) {
                        window.TurtleTimers.splice(index, 1);
                      }
                    }
                    this._timer = undefined;
                }

                if (method && typeof interval === "number") {
                    this._timer = window.setTimeout(method, Math.max(0, interval|0));
                    if (window.TurtleTimers == undefined) {
                      window.TurtleTimers = [];
                    }
                    window.TurtleTimers.push(this._timer);
                }
            };
            proto.$ontimer.minArgs = 0;

        })(Screen.prototype);

        function ensureAnonymous() {
            if (!_anonymousTurtle) {
                _anonymousTurtle = Sk.misceval.callsim(_module.Turtle);
            }

            return _anonymousTurtle.instance;
        }

        /**
         * 获取绘制画布
         */
        function getTarget() {
            return _target;
        }

        /**
         * 获取screen对象的单例
         * llx urx 宽度的一半
         * lly ury 高度的一半
         */
        function getScreen() {
            if (!_screenInstance) {
                _screenInstance = new Screen();
            }
            return _screenInstance;
        }

        function getMouseHandler() {
            if (!_mouseHandler) {
                _mouseHandler = new MouseHandler();
            }
            return _mouseHandler;
        }

        function getWidth() {
            return (
                (_screenInstance && _screenInstance._width) ||
                _config.width ||
                getTarget().clientWidth
            ) | 0;
        }

        function getHeight() {
            return (
                (_screenInstance && _screenInstance._height) ||
                _config.height ||
                getTarget().clientHeight
            ) | 0;
        }

        /**
         * Layer = canvas，程序中存在四种Layer
         * 分别由screen和frame创建
         *
         * screen - testLayer
         * screen - bgLayer
         * frame - paperLayer
         * screen - spriteLayer
         *
         * @param {*} zIndex
         * @param {*} isHidden
         */
        function createLayer(zIndex, isHidden) {
            var canvas = document.createElement("canvas"),
                width  = getWidth(),
                height = getHeight(),
                offset = getTarget().firstChild ? (-height) + "px" : "0",
                context;

            canvas.setAttribute('type', (function() {
                switch(zIndex) {
                    case 0:
                        return 'testLayer';
                    case 1:
                        return 'bgLayer';
                    case 2:
                        return 'paperLayer';
                    case 3:
                        return 'spriteLayer';
                }
            })(zIndex))

            canvas.width          = width;
            canvas.height         = height;
            canvas.style.position = "relative";
            canvas.style.display  = "block";
            canvas.style.outline  = "none";
            canvas.style.setProperty("margin-top",offset);
            canvas.style.setProperty("z-index", zIndex);
            if (isHidden) {
                canvas.style.display = "none";
            }

            getTarget().appendChild(canvas);

            context = canvas.getContext("2d");
            context.lineCap = "round";
            context.lineJoin = "round";

            applyWorld(getScreen(), context);

            return context;
        }

        /**
         * 已请求未执行的frame置空；TODO: _frameRequest和_frames的区别？
         * 定时请求执行的的frame取消；
         */
        function cancelAnimationFrame() {
            if (_frameRequest) {
                (window.cancelAnimationFrame || window.mozCancelAnimationFrame)(_frameRequest);
                _frameRequest = undefined;
            }
            if (_frameRequestTimeout) {
                window.clearTimeout(_frameRequestTimeout);
                _frameRequestTimeout = undefined;
            }
        }

        function applyWorld(world, context) {
            var llx    = world.llx,
                lly    = world.lly,
                urx    = world.urx,
                ury    = world.ury,
                xScale = world.xScale,
                yScale = world.yScale;

            if (!context) return;

            clearLayer(context);

            context.restore();
            context.save();
            context.scale(1 / xScale, 1 / yScale);
            if (lly === 0) {
                context.translate(-llx, lly - (ury - lly));
            } else if (lly > 0) {
                context.translate(-llx, -lly * 2);
            } else {
                context.translate(-llx, -ury);
            }
        }

        function pushUndo(turtle) {
            var properties, undoState, i;

            if (!_config.allowUndo || !turtle._bufferSize) {
                return;
            }

            if (!turtle._undoBuffer) {
                turtle._undoBuffer = [];
            }

            while(turtle._undoBuffer.length > turtle._bufferSize) {
                turtle._undoBuffer.shift();
            }

            undoState  = {};
            properties = "x y angle radians color fill down filling shown shape size".split(" ");
            for(i = 0; i < properties.length; i++) {
                undoState[properties[i]] = turtle["_" + properties[i]];
            }

            turtle._undoBuffer.push(undoState);

            return turtle.addUpdate(function() {
                undoState.fillBuffer = this.fillBuffer ? this.fillBuffer.slice() : undefined;
                if (turtle._paper && turtle._paper.canvas) {
                    undoState.image = turtle._paper.canvas.toDataURL();
                }
            }, false);
        }

        var undoImage = new Image();
        function popUndo(turtle) {
            var undoState;

            if (!turtle._bufferSize || !turtle._undoBuffer) {
                return;
            }

            undoState = turtle._undoBuffer.pop();

            if (!undoState) {
                return;
            }

            for(var key in undoState) {
                if (key === "image" || key === "fillBuffer") continue;
                turtle["_" + key] = undoState[key];
            }

            return turtle.addUpdate(function() {
                var img;
                if (undoState.image) {
                    undoImage.src = undoState.image;
                    img = undoImage;
                }

                clearLayer(this.context(), false, undoImage);
                delete undoState.image;
            }, true, undoState);
        }

        function removeLayer(layer) {
            if (layer && layer.canvas && layer.canvas.parentNode) {
                layer.canvas.parentNode.removeChild(layer.canvas);
            }
        }

        /**
         * 先以color绘制覆盖整个画布，再以image绘制整个画布
         *
         * @param {*} context
         * @param {*} color
         * @param {*} image
         */
        function clearLayer(context, color, image) {
            if (!context) return;

            context.save();
            context.setTransform(1,0,0,1,0,0);
            if (color) {
                context.fillStyle = color;
                context.fillRect(0, 0, context.canvas.width, context.canvas.height);
            }
            else {
                context.clearRect(0, 0, context.canvas.width, context.canvas.height);
            }

            if (image) {
                var imageWidth = image.width;
                var imageHeight = image.height;
                var contextWidth = context.canvas.width;
                var contextHeight = context.canvas.height;
                var dx = (contextWidth - imageWidth)/2
                var dy = (contextHeight - imageHeight)/2
                context.drawImage(image, dx, dy);
            }

            context.restore();
        }

        /**
         * turtle绘制，调用来源？TODO:
         * @param {*} state
         * @param {*} context
         */
        function drawTurtle(state, context) {
          var shape  = SHAPES[state.shape],
              world  = getScreen(),
              width  = getWidth(),
              height = getHeight(),
              xScale = world.xScale,
              yScale = world.yScale,
              x, y, bearing;

          if (!context) return;

          x       = Math.cos(state.radians) / xScale;
          y       = Math.sin(state.radians) / yScale;

          context.save();
          context.translate(state.x, state.y);
          if (shape.nodeName) {
              context.scale(xScale, yScale);
              var iw = shape.naturalWidth;
              var ih = shape.naturalHeight;
              context.drawImage(shape, 0, 0, iw, ih, -iw/2, -ih/2, iw, ih);
          }
          else {
              bearing = Math.PI/2 - Math.atan2(y, x);
              context.rotate(bearing);
              context.scale(xScale * state.wid, yScale * state.len);
              context.beginPath();
              context.lineWidth   = state.outline;
              context.strokeStyle = state.color;
              context.fillStyle   = state.fill;
              context.moveTo(shape[0][0], shape[0][1]);
              for(var i = 1; i < shape.length; i++) {
                  context.lineTo(shape[i][0] , shape[i][1] );
              }
              context.closePath();
              context.fill();
              context.stroke();
          }
          context.restore();
        }

        function drawDot(size, color) {
            var context = this.context(),
                screen  = getScreen(),
                xScale  = screen.xScale,
                yScale  = screen.yScale;

            if (!context) return;
            context.beginPath();
            context.moveTo(this.x, this.y);
            size = size * Math.min(Math.abs(xScale),Math.abs(yScale));
            context.arc(this.x, this.y, size/2, 0, Turtle.RADIANS);
            context.closePath();
            context.fillStyle = color || this.color;
            context.fill();
        }

        var textMeasuringContext = document.createElement("canvas").getContext("2d");
        function measureText(message, font) {
            if (font) {
                textMeasuringContext.font = font;
            }
            return textMeasuringContext.measureText(message).width;
        }

        function drawText(message, align, font) {
            var context = this.context();

            if (!context) return;

            context.save();
            if (font) {
                context.font = font;
            }
            if (align && align.match(/^(left|right|center)$/)) {
                context.textAlign = align;
            }

            context.scale(1,-1);
            context.fillStyle = this.fill;
            context.fillText(message, this.x, -this.y);
            context.restore();
        }

        function drawLine(loc, beginPath, endPath) {
            // TODO: make steps in path use square ends of lines
            // and open and close path at the right times.
            // See if we can minimize calls to stroke
            var context = this.context();

            if (!context) return;

            if (beginPath) {
                context.beginPath();
                context.moveTo(this.x, this.y);
            }

            context.lineWidth   = this.size * getScreen().lineScale;
            context.strokeStyle = this.color;
            context.lineTo(loc.x, loc.y);
            context.stroke();
        }

        function drawFill() {
            var context = this.context(),
                path  = this.fillBuffer,
                i;

            if (!context || !path || !path.length) return;

            context.save();
            context.beginPath();
            context.moveTo(path[0].x,path[0].y);
            for(i = 1; i < path.length; i++) {
                context.lineTo(path[i].x, path[i].y);
            }
            context.closePath();
            context.fillStyle = this.fill;
            context.fill();
            for(i = 1; i < path.length; i++) {
                if (!path[i].stroke) {
                    continue;
                }

                context.beginPath();
                context.moveTo(path[i-1].x, path[i-1].y);
                context.lineWidth   = path[i].size * getScreen().lineScale;
                context.strokeStyle = path[i].color;
                context.lineTo(path[i].x, path[i].y);
                context.stroke();
            }
            context.restore();
        }

        /**
         * 逐步移动
         * @param {turtle} turtle
         * @param {number} x 终点x坐标
         * @param {number} y 终点y坐标
         * @param {boolean} beginPath 是否是动作的开始第一步
         * @param {boolean} countAsFrame
         */
        function partialTranslate(turtle, x, y, beginPath, countAsFrame) {
            return function() {
                return turtle.addUpdate(
                    function(loc) {
                        if (this.down) {
                            drawLine.call(this, loc, beginPath);
                        }
                    },
                    countAsFrame,
                    {x : x, y : y},
                    beginPath
                );
            };
        }

        /**
         * 移动turtle
         * @param {*} turtle
         * @param {number} startX 移动起点x坐标
         * @param {number} startY 移动起点y坐标
         * @param {number} dx x轴移动距离
         * @param {number} dy y轴移动距离
         * @param {boolean} beginPath 是否是动作的开始第一步
         * @param {boolean} isCircle TODO:
         */
        function translate(turtle, startX, startY, dx, dy, beginPath, isCircle) {
            // speed is in pixels per ms
            var speed   = turtle._computed_speed,                               // 每毫秒移动像素
                screen  = getScreen(),                                          // 绘制画布
                xScale  = Math.abs(screen.xScale),                              // 绘制画布的x轴缩放值
                yScale  = Math.abs(screen.yScale),                              // 绘制画布的y轴缩放值
                x       = startX,                                               // 移动起点x坐标
                y       = startY,                                               // 移动起点y坐标
                pixels  = Math.sqrt(dx * dx * xScale + dy * dy * yScale),       // 计算起点和终点距离，需要移除x/y轴缩放值的影响
                // TODO: allow fractional frame updates?
                frames  = speed ? Math.round(Math.max(1, pixels / speed)) : 1,  // 需要frames帧完成移动，frames = 距离 / 速度，最小值为1
                xStep   = dx / frames,                                          // 每一帧x轴移动像素
                yStep   = dy / frames,                                          // 每一帧y轴移动像素
                promise = getFrameManager().willRenderNext() ?                  // 判断当前是否可以渲染，如果不能则：TODO:
                    Promise.resolve() :
                    new InstantPromise(),
                countAsFrame = (!speed && isCircle) ? false : true,             // 如果速度为0，且是画圆，则作为一帧。TODO: 作为一帧的作用？
                i;


            turtle.addUpdate(function() {
                // 填色操作
                if (this.filling) {
                    this.fillBuffer.push({
                        x        : this.x,
                        y      : this.y,
                        stroke : this.down,
                        color  : this.color,
                        size   : this.size
                    });
                }
            }, false);

            for(i = 0; i < frames; i++) {
                x = startX + xStep * (i+1);
                y = startY + yStep * (i+1);
                promise = promise.then(
                    partialTranslate(turtle, x, y, beginPath, countAsFrame)
                );
                beginPath = false;
            }

            return promise.then(function() {
                return [startX + dx, startY + dy];
            });
        }

        function partialRotate(turtle, angle, radians, countAsFrame) {
            return function() {
                return turtle.addUpdate(undefined, countAsFrame, {angle:angle, radians:radians});
            };
        }

        function rotate(turtle, startAngle, delta, isCircle) {
            var speed        = turtle._computed_speed,
                degrees    = delta / turtle._fullCircle * 360,
                frames     = speed ? Math.round(Math.max(1, Math.abs(degrees) / speed)) : 1,
                dAngle     = delta / frames,
                heading    = {},
                countAsFrame = (!speed && isCircle) ? false : true,
                promise    = getFrameManager().willRenderNext() ?
                    Promise.resolve() :
                    new InstantPromise(),
                i;

            // TODO: request how many frames are remaining and only queue up
            // a single rotation per screen update

            for(i = 0; i < frames; i++) {
                calculateHeading(turtle, startAngle + dAngle * (i+1), heading);
                promise = promise.then(
                    partialRotate(turtle, heading.angle, heading.radians, countAsFrame)
                );
            }

            return promise.then(function() {
                return calculateHeading(turtle, startAngle + delta);
            });
        }

        function getCoordinates(x, y) {
            if (y === undefined) {
                y = (x && (x.y || x._y || x[1])) || 0;
                x = (x && (x.x || x._x || x[0])) || 0;
            }
            return {x:x, y:y};
        }

        // Modified solution of Tim Down's version from stackoverflow
        // http://stackoverflow.com/questions/5623838/rgb-to-hex-and-hex-to-rgb
        function hexToRGB(hex) {
            var rgbForm, hexForm, result;

            if (rgbForm = /^rgba?\((\d+),(\d+),(\d+)(?:,([.\d]+))?\)$/.exec(hex)) {
                if(parseInt(_config.colorMode) == 1) {
                  result = [
                    parseFloat(rgbForm[1])/255.0,
                    parseFloat(rgbForm[2])/255.0,
                    parseFloat(rgbForm[3])/255.0
                  ];
                }else {
                  result = [
                    parseInt(rgbForm[1]),
                    parseInt(rgbForm[2]),
                    parseInt(rgbForm[3])
                  ];
                }
                if (rgbForm[4]) {
                    result.push(parseFloat(rgbForm[4]));
                }
            }
            else if (/^#?[a-f\d]{3}|[a-f\d]{6}$/i.exec(hex)) {
                if (hex.length === 4) {
                    // Expand shorthand form (e.g. "03F") to full form (e.g. "0033FF")
                    hex = hex.replace(/^#?([a-f\d])([a-f\d])([a-f\d])$/i, function(m, r, g, b) {
                            return r + r + g + g + b + b;
                    });
                }

                hexForm = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
                result = [
                    parseInt(hexForm[1], 16),
                    parseInt(hexForm[2], 16),
                    parseInt(hexForm[3], 16)
                ];
            }
            else {
                result = hex;
            }

            return result;
        }

        function createColor(color, g, b, a) {
            var i;

            if (g !== undefined) {
                color = [color, g, b, a];
            }

            if (color.constructor === Array && color.length) {
                for(i = 0; i < 3; i++) {
                  if(parseInt(_config.colorMode) == 1){
                    if(parseFloat(color[i]) > 1){
                      throw new SyntaxError('bad color sequence');
                    }
                    color[i] = (typeof color[i] === "number") ?
                    Math.max(0, Math.min(255, parseFloat(color[i])*255)) :0;
                  }else{
                    color[i] = (typeof color[i] === "number") ?Math.max(0, Math.min(255, parseInt(color[i]))) :0;
                  }
                }
                if (typeof color[i] === "number") {
                    color[3] = Math.max(0, Math.min(1, color[i]));
                    color = "rgba(" + color.join(",") + ")";
                }
                else {
                    color = "rgb(" + color.slice(0,3).join(",") + ")";
                }
            }
            else if (typeof color === "string" && !color.match(/\s*url\s*\(/i)) {
                color = color.replace(/\s+/g, "");
            }
            else {
                return "black";
            }

            return color;
        }

        function calculateHeading(turtle, value, heading) {
            var angle   = turtle._angle   || 0,
                radians = turtle._radians || 0;

            heading || (heading = {});

            if (typeof value === "number") {
                if (turtle._isRadians) {
                    angle = radians = value % Turtle.RADIANS;
                }
                else if (turtle._fullCircle) {
                    angle   = (value % turtle._fullCircle);
                    radians = angle / turtle._fullCircle * Turtle.RADIANS;
                }
                else {
                    angle = radians = 0;
                }

                if (angle < 0) {
                    angle   += turtle._fullCircle;
                    radians += Turtle.RADIANS;
                }
            }

            heading.angle   = angle;
            heading.radians = radians;

            return heading;
        }

        function pythonToJavascriptFunction(pyValue, scope) {
            return function() {
                var callAfter = this.callAfter;
                var argsJs = Array.prototype.slice.call(arguments),
                    argsPy = argsJs.map(
                        function(argJs) {return Sk.ffi.remapToPy(argJs);}
                    );

                if (typeof(scope) !== "undefined") {
                    argsPy.unshift(scope);
                }
                return Sk.misceval.applyAsync(
                    undefined, pyValue, undefined, undefined, undefined, argsPy
                ).then(function() {
                    if(callAfter) {
                        callAfter()
                    }
                }).catch(Sk.uncaughtException);
            };
        }

        function addModuleMethod(klass, module, method, scopeGenerator) {
            var publicMethodName = method.replace(/^\$/, ""),
                displayName      = publicMethodName.replace(/_\$[a-z]+\$$/i, ""),
                maxArgs          = klass.prototype[method].length,
                minArgs          = klass.prototype[method].minArgs,
                keywordArgs      = klass.prototype[method].keywordArgs,
                returnType       = klass.prototype[method].returnType,
                isSk             = klass.prototype[method].isSk,
                wrapperFn;

            if (minArgs === undefined) {
                minArgs = maxArgs;
            }

            wrapperFn = function() {
                var args     = Array.prototype.slice.call(arguments, 0),
                    instance = scopeGenerator ? scopeGenerator() : args.shift().instance,
                    i, result, susp, resolution, lengthError;

                if (args.length < minArgs || args.length > maxArgs) {
                    lengthError = minArgs === maxArgs ?
                        "exactly " + maxArgs :
                        "between " + minArgs + " and " + maxArgs;

                    throw new Sk.builtin.TypeError(displayName + "() takes " + lengthError + " positional argument(s) (" + args.length + " given)");
                }

                for (i = args.length; --i >= 0;) {
                    if (args[i] !== undefined) {
                        if (args[i] instanceof Sk.builtin.func) {
                            args[i] = pythonToJavascriptFunction(args[i]);
                        }
                        else if (args[i] instanceof Sk.builtin.method) {
                            args[i] = pythonToJavascriptFunction(args[i].im_func, args[i].im_self);
                        }
                        else if (args[i] && args[i].$d instanceof Sk.builtin.dict && args[i].instance) {
                            args[i] = args[i].instance;
                        }
                        else {
                            args[i] = Sk.ffi.remapToJs(args[i]);
                        }
                    }
                }

                try {
                    result = instance[method].apply(instance, args);
                } catch(e) {
                    if (window && window.console) {
                        window.console.log("wrapped method failed");
                        window.console.log(e.stack);
                    }
                    throw e;
                }

                if (result instanceof InstantPromise) {
                    result = result.lastResult;
                }

                if (result instanceof Promise) {
                    result = result.catch(function(e) {
                        if (window && window.console) {
                            window.console.log("promise failed");
                            window.console.log(e.stack);
                        }
                        throw e;
                    });

                    susp = new Sk.misceval.Suspension();

                    susp.resume = function() {
                        return (resolution === undefined) ?
                            Sk.builtin.none.none$ :
                            Sk.ffi.remapToPy(resolution);
                    };

                    susp.data = {
                        type: "Sk.promise",
                        promise: result.then(function(value) {
                            resolution = value;
                            return value;
                        })
                    };

                    return susp;
                }
                else {
                    if (result === undefined) return Sk.builtin.none.none$;
                    if (isSk) return result;
                    if (typeof returnType === "function") {
                        return returnType(result);
                    }

                    return Sk.ffi.remapToPy(result);
                }
            };

            if (keywordArgs) {
                wrapperFn.co_varnames = keywordArgs.slice();
                // make room for required arguments
                for(var i = 0; i < minArgs; i++) {
                    wrapperFn.co_varnames.unshift("");
                }
                if (!scopeGenerator) {
                    // make room for the "self" argument
                    wrapperFn.co_varnames.unshift("");
                }
            }

            module[publicMethodName] = new Sk.builtin.func(wrapperFn);
        }

        function TurtleWrapper($gbl, $loc) {
            $loc.__init__ = new Sk.builtin.func(function (self) {
                self.instance = new Turtle();
                self.instance.skInstance = self;
            });

            for(var key in Turtle.prototype) {
                if (/^\$[a-z_]+/.test(key)) {
                    addModuleMethod(Turtle, $loc, key);
                }
            }
        }

        function ScreenWrapper($gbl, $loc) {
            $loc.__init__ = new Sk.builtin.func(function (self) {
                self.instance = getScreen();
            });

            for(var key in Screen.prototype) {
                if (/^\$[a-z_]+/.test(key)) {
                    addModuleMethod(Screen, $loc, key);
                }
            }
        }

        for(var key in Turtle.prototype) {
            if (/^\$[a-z_]+/.test(key)) {
                addModuleMethod(Turtle, _module, key, ensureAnonymous);
            }
        }

        // add Screen method aliases to the main turtle module
        // to allow things like:
        //   import turtle
        //   turtle.mainloop()
        addModuleMethod(Screen, _module, "$mainloop", getScreen);
        addModuleMethod(Screen, _module, "$done", getScreen);
        addModuleMethod(Screen, _module, "$bye", getScreen);
        addModuleMethod(Screen, _module, "$tracer", getScreen);
        addModuleMethod(Screen, _module, "$update", getScreen);
        addModuleMethod(Screen, _module, "$delay", getScreen);
        addModuleMethod(Screen, _module, "$window_width", getScreen);
        addModuleMethod(Screen, _module, "$window_height", getScreen);
        addModuleMethod(Screen, _module, "$bgcolor", getScreen);
        addModuleMethod(Screen, _module, "$bgpic", getScreen);
        addModuleMethod(Screen, _module, "$addshape", getScreen);
        addModuleMethod(Screen, _module, "$colormode", getScreen);
        addModuleMethod(Screen, _module, "$ontimer", getScreen);
        addModuleMethod(Screen, _module, "$onscreenclick", getScreen);
        addModuleMethod(Screen, _module, "$onkey", getScreen);
        addModuleMethod(Screen, _module, "$onkeypress", getScreen);
        addModuleMethod(Screen, _module, "$listen", getScreen);
        addModuleMethod(Screen, _module, "$setup", getScreen);

        _module.Pen = Sk.misceval.buildClass(_module, TurtleWrapper, "Pen", []);
        _module.Turtle = Sk.misceval.buildClass(_module, TurtleWrapper, "Turtle", []);
        _module.Screen = Sk.misceval.buildClass(_module, ScreenWrapper, "Screen", []);

        // Calling focus(false) will block turtle key/mouse events
        // until focus(true) is called again or until the turtle DOM target
        // is clicked/tabbed into.
        function focusTurtle(value) {
            if (value !== undefined) {
                _focus = !!value;
                if (_focus) {
                    getTarget().focus();
                }
                else {
                    getTarget().blur();
                }
            }

            return _focus;
        }

        function resetTurtle() {
            cancelAnimationFrame();
            getScreen().reset();
            getFrameManager().reset();

            while (_target.firstChild) {
                _target.removeChild(_target.firstChild);
            }

            if (_mouseHandler) {
                _mouseHandler.reset();
            }

            _durationSinceRedraw = 0;
            _screenInstance      = undefined;
            _anonymousTurtle     = undefined;
            _mouseHandler        = undefined;
            TURTLE_COUNT         = 0;
        }

        function stopTurtle() {
            cancelAnimationFrame();

            if (_mouseHandler) {
                _mouseHandler.reset();
            }

            _durationSinceRedraw = 0;
            _screenInstance      = undefined;
            _anonymousTurtle     = undefined;
            _mouseHandler        = undefined;
            TURTLE_COUNT         = 0;
        }

        return {
            skModule : _module,
            reset    : resetTurtle,
            stop     : stopTurtle,
            focus    : focusTurtle,
            Turtle   : Turtle,
            Screen   : Screen,
            Pen: _module.Pen
        };
    }

    // See if the TurtleGraphics module has already been loaded
    // for the currently configured DOM target element.
    var currentTarget = getConfiguredTarget();

    if (!currentTarget.turtleInstance) {
        currentTarget.turtleInstance = generateTurtleModule(currentTarget);
    }
    else {
        currentTarget.turtleInstance.reset();
    }

    Sk.TurtleGraphics.module = currentTarget.turtleInstance.skModule;
    Sk.TurtleGraphics.reset  = currentTarget.turtleInstance.reset;
    Sk.TurtleGraphics.stop   = currentTarget.turtleInstance.stop;
    Sk.TurtleGraphics.focus  = currentTarget.turtleInstance.focus;
    Sk.TurtleGraphics.raw = {
        Turtle : currentTarget.turtleInstance.Turtle,
        Screen : currentTarget.turtleInstance.Screen,
        Pen: currentTarget.turtleInstance.Pen
    };

    return currentTarget.turtleInstance.skModule;

    };
