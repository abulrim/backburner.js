import { DeferredActionQueues } from "backburner/deferred_action_queues";

var slice = [].slice,
    pop = [].pop,
    throttlers = [],
    debouncees = [],
    timers = [],
    autorun, laterTimer, laterTimerExpiresAt,
    global = this,
    NUMBER = /\d+/;

function isCoercableNumber(number) {
  return typeof number === 'number' || NUMBER.test(number);
}

function Backburner(queueNames, options) {
  this.queueNames = queueNames;
  this.options = options || {};
  if (!this.options.defaultQueue) {
    this.options.defaultQueue = queueNames[0];
  }
  this.instanceStack = [];
}

Backburner.prototype = {
  queueNames: null,
  options: null,
  currentInstance: null,
  instanceStack: null,

  begin: function() {
    var options = this.options,
        onBegin = options && options.onBegin,
        previousInstance = this.currentInstance;

    if (previousInstance) {
      this.instanceStack.push(previousInstance);
    }

    this.currentInstance = new DeferredActionQueues(this.queueNames, options);
    if (onBegin) {
      onBegin(this.currentInstance, previousInstance);
    }
  },

  end: function() {
    var options = this.options,
        onEnd = options && options.onEnd,
        currentInstance = this.currentInstance,
        nextInstance = null;

    try {
      currentInstance.flush();
    } finally {
      this.currentInstance = null;

      if (this.instanceStack.length) {
        nextInstance = this.instanceStack.pop();
        this.currentInstance = nextInstance;
      }

      if (onEnd) {
        onEnd(currentInstance, nextInstance);
      }
    }
  },

  run: function(target, method /*, args */) {
    var options = this.options,
        ret;

    this.begin();

    if (!method) {
      method = target;
      target = null;
    }

    if (typeof method === 'string') {
      method = target[method];
    }

    var onError = options.onError || (options.onErrorTarget && options.onErrorTarget[options.onErrorMethod]);

    // Prevent Safari double-finally.
    var finallyAlreadyCalled = false;
    try {
      if (arguments.length > 2) {
        if (onError) {
          // Do we need this double try?
          try {
            ret = method.apply(target, slice.call(arguments, 2));
          } catch (e) {
            onError(e);
          }
        } else {
          ret = method.apply(target, slice.call(arguments, 2));
        }
      } else {
        if (onError) {
          // Do we need this double try?
          try {
            ret = method.call(target);
          } catch (e) {
            onError(e);
          }
        } else {
          ret = method.call(target);
        }
      }
    } finally {
      if (!finallyAlreadyCalled) {
        finallyAlreadyCalled = true;
        this.end();
      }
    }
    return ret;
  },

  defer: function(queueName, target, method /* , args */) {
    if (!method) {
      method = target;
      target = null;
    }

    if (typeof method === 'string') {
      method = target[method];
    }

    var stack = this.DEBUG ? new Error() : undefined,
        args = arguments.length > 3 ? slice.call(arguments, 3) : undefined;
    if (!this.currentInstance) { createAutorun(this); }
    return this.currentInstance.schedule(queueName, target, method, args, false, stack);
  },

  deferOnce: function(queueName, target, method /* , args */) {
    if (!method) {
      method = target;
      target = null;
    }

    if (typeof method === 'string') {
      method = target[method];
    }

    var stack = this.DEBUG ? new Error() : undefined,
        args = arguments.length > 3 ? slice.call(arguments, 3) : undefined;
    if (!this.currentInstance) { createAutorun(this); }
    return this.currentInstance.schedule(queueName, target, method, args, true, stack);
  },

  setTimeout: function() {
    var args = slice.call(arguments);
    var length = args.length;
    var method, wait, target;
    var self = this;
    var methodOrTarget, methodOrWait, methodOrArgs;
    var options = this.options;

    if (length === 0) {
      return;
    } else if (length === 1) {
      method = args.shift();
      wait = 0;
    } else if (length === 2) {
      methodOrTarget = args[0];
      methodOrWait = args[1];

      if (typeof methodOrWait === 'function' || typeof  methodOrTarget[methodOrWait] === 'function') {
        target = args.shift();
        method = args.shift();
        wait = 0;
      } else if (isCoercableNumber(methodOrWait)) {
        method = args.shift();
        wait = args.shift();
      } else {
        method = args.shift();
        wait =  0;
      }
    } else {
      var last = args[args.length - 1];

      if (isCoercableNumber(last)) {
        wait = args.pop();
      } else {
        wait = 0;
      }

      methodOrTarget = args[0];
      methodOrArgs = args[1];

      if (typeof methodOrArgs === 'function' || (typeof methodOrArgs === 'string' &&
                                                 methodOrTarget !== null &&
                                                 methodOrArgs in methodOrTarget)) {
        target = args.shift();
        method = args.shift();
      } else {
        method = args.shift();
      }
    }

    var executeAt = (+new Date()) + parseInt(wait, 10);

    if (typeof method === 'string') {
      method = target[method];
    }

    var onError = options.onError || (options.onErrorTarget && options.onErrorTarget[options.onErrorMethod]);

    function fn() {
      if (onError) {
        try {
          method.apply(target, args);
        } catch (e) {
          onError(e);
        }
      } else {
        method.apply(target, args);
      }
    }

    // find position to insert
    var i = searchTimer(executeAt, timers);

    timers.splice(i, 0, executeAt, fn);

    updateLaterTimer(self, executeAt, wait);

    return fn;
  },

  throttle: function(target, method /* , args, wait, [immediate] */) {
    var self = this,
        args = arguments,
        immediate = pop.call(args),
        wait,
        throttler,
        index,
        timer;

    if (typeof immediate === "number" || typeof immediate === "string") {
      wait = immediate;
      immediate = true;
    } else {
      wait = pop.call(args);
    }

    wait = parseInt(wait, 10);

    index = findThrottler(target, method);
    if (index > -1) { return throttlers[index]; } // throttled

    timer = global.setTimeout(function() {
      if (!immediate) {
        self.run.apply(self, args);
      }
      var index = findThrottler(target, method);
      if (index > -1) { throttlers.splice(index, 1); }
    }, wait);

    if (immediate) {
      self.run.apply(self, args);
    }

    throttler = [target, method, timer];

    throttlers.push(throttler);

    return throttler;
  },

  debounce: function(target, method /* , args, wait, [immediate] */) {
    var self = this,
        args = arguments,
        immediate = pop.call(args),
        wait,
        index,
        debouncee,
        timer;

    if (typeof immediate === "number" || typeof immediate === "string") {
      wait = immediate;
      immediate = false;
    } else {
      wait = pop.call(args);
    }

    wait = parseInt(wait, 10);
    // Remove debouncee
    index = findDebouncee(target, method);

    if (index > -1) {
      debouncee = debouncees[index];
      debouncees.splice(index, 1);
      clearTimeout(debouncee[2]);
    }

    timer = global.setTimeout(function() {
      if (!immediate) {
        self.run.apply(self, args);
      }
      var index = findDebouncee(target, method);
      if (index > -1) {
        debouncees.splice(index, 1);
      }
    }, wait);

    if (immediate && index === -1) {
      self.run.apply(self, args);
    }

    debouncee = [target, method, timer];

    debouncees.push(debouncee);

    return debouncee;
  },

  cancelTimers: function() {
    var i, len;

    for (i = 0, len = throttlers.length; i < len; i++) {
      clearTimeout(throttlers[i][2]);
    }
    throttlers = [];

    for (i = 0, len = debouncees.length; i < len; i++) {
      clearTimeout(debouncees[i][2]);
    }
    debouncees = [];

    if (laterTimer) {
      clearTimeout(laterTimer);
      laterTimer = null;
    }
    timers = [];

    if (autorun) {
      clearTimeout(autorun);
      autorun = null;
    }
  },

  hasTimers: function() {
    return !!timers.length || !!debouncees.length || !!throttlers.length || autorun;
  },

  cancel: function(timer) {
    var timerType = typeof timer;

    if (timer && timerType === 'object' && timer.queue && timer.method) { // we're cancelling a deferOnce
      return timer.queue.cancel(timer);
    } else if (timerType === 'function') { // we're cancelling a setTimeout
      for (var i = 0, l = timers.length; i < l; i += 2) {
        if (timers[i + 1] === timer) {
          timers.splice(i, 2); // remove the two elements
          return true;
        }
      }
    } else if (Object.prototype.toString.call(timer) === "[object Array]"){ // we're cancelling a throttle or debounce
      return this._cancelItem(findThrottler, throttlers, timer) ||
               this._cancelItem(findDebouncee, debouncees, timer);
    } else {
      return; // timer was null or not a timer
    }
  },

  _cancelItem: function(findMethod, array, timer){
    var item,
        index;

    if (timer.length < 3) { return false; }

    index = findMethod(timer[0], timer[1]);

    if(index > -1) {

      item = array[index];

      if(item[2] === timer[2]){
        array.splice(index, 1);
        clearTimeout(timer[2]);
        return true;
      }
    }

    return false;
  }

};

Backburner.prototype.schedule = Backburner.prototype.defer;
Backburner.prototype.scheduleOnce = Backburner.prototype.deferOnce;
Backburner.prototype.later = Backburner.prototype.setTimeout;

function createAutorun(backburner) {
  backburner.begin();
  autorun = global.setTimeout(function() {
    autorun = null;
    backburner.end();
  });
}

function updateLaterTimer(self, executeAt, wait) {
  if (!laterTimer || executeAt < laterTimerExpiresAt) {
    if (laterTimer) {
      clearTimeout(laterTimer);
    }
    laterTimer = global.setTimeout(function() {
      laterTimer = null;
      laterTimerExpiresAt = null;
      executeTimers(self);
    }, wait);
    laterTimerExpiresAt = executeAt;
  }
}

function executeTimers(self) {
  var now = +new Date(),
      time, fns, i, l;

  self.run(function() {
    i = searchTimer(now, timers);

    fns = timers.splice(0, i);

    for (i = 1, l = fns.length; i < l; i += 2) {
      self.schedule(self.options.defaultQueue, null, fns[i]);
    }
  });

  if (timers.length) {
    updateLaterTimer(self, timers[0], timers[0] - now);
  }
}

function findDebouncee(target, method) {
  var debouncee,
      index = -1;

  for (var i = 0, l = debouncees.length; i < l; i++) {
    debouncee = debouncees[i];
    if (debouncee[0] === target && debouncee[1] === method) {
      index = i;
      break;
    }
  }

  return index;
}

function findThrottler(target, method) {
  var throttler,
      index = -1;

  for (var i = 0, l = throttlers.length; i < l; i++) {
    throttler = throttlers[i];
    if (throttler[0] === target && throttler[1] === method) {
      index = i;
      break;
    }
  }

  return index;
}

function searchTimer(time, timers) {
  var start = 0,
      end = timers.length - 2,
      middle, l;

  while (start < end) {
    // since timers is an array of pairs 'l' will always
    // be an integer
    l = (end - start) / 2;

    // compensate for the index in case even number
    // of pairs inside timers
    middle = start + l - (l % 2);

    if (time >= timers[middle]) {
      start = middle + 2;
    } else {
      end = middle;
    }
  }

  return (time >= timers[start]) ? start + 2 : start;
}

export { Backburner };
