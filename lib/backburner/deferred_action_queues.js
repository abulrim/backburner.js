import { Queue } from "backburner/queue";

function DeferredActionQueues(queueNames, options) {
  var queues = this.queues = {};
  this.queueNames = queueNames = queueNames || [];

  this.options = options;

  var queueName;
  for (var i = 0, l = queueNames.length; i < l; i++) {
    queueName = queueNames[i];
    queues[queueName] = new Queue(this, queueName, this.options);
  }
}

DeferredActionQueues.prototype = {
  queueNames: null,
  queues: null,
  options: null,

  schedule: function(queueName, target, method, args, onceFlag, stack) {
    var queues = this.queues,
        queue = queues[queueName];

    if (!queue) { throw new Error("You attempted to schedule an action in a queue (" + queueName + ") that doesn't exist"); }

    if (onceFlag) {
      return queue.pushUnique(target, method, args, stack);
    } else {
      return queue.push(target, method, args, stack);
    }
  },

  flush: function() {
    var queues = this.queues,
        queueNames = this.queueNames,
        queueName, queue, queueItems, priorQueueNameIndex,
        queueNameIndex = 0, numberOfQueues = queueNames.length;

    outerloop:
    while (queueNameIndex < numberOfQueues) {
      queueName = queueNames[queueNameIndex];
      queue = queues[queueName];
      queueItems = queue._queueBeingFlushed = queue._queue.slice();
      queue._queue = [];

      var queueOptions = queue.options, // TODO: write a test for this
          options = this.options,
          before = queueOptions && queueOptions.before,
          after = queueOptions && queueOptions.after,
          onError = options.onError || (options.onErrorTarget && options.onErrorTarget[options.onErrorMethod]),
          target, method, args, stack,
          queueIndex = 0, numberOfQueueItems = queueItems.length;

      if (numberOfQueueItems && before) { before(); }
      while (queueIndex < numberOfQueueItems) {
        target = queueItems[queueIndex];
        method = queueItems[queueIndex+1];
        args   = queueItems[queueIndex+2];
        stack  = queueItems[queueIndex+3]; // Debugging assistance

        if (typeof method === 'string') { method = target[method]; }

        // method could have been nullified / canceled during flush
        if (method) {
          // TODO: error handling
          if (args && args.length > 0) {
            if (onError) {
              try {
                method.apply(target, args);
              } catch (e) {
                onError(e);
              }
            } else {
              method.apply(target, args);
            }
          } else {
            if (onError) {
              try {
                method.call(target);
              } catch(e) {
                onError(e);
              }
            } else {
              method.call(target);
            }
          }
        }

        queueIndex += 4;
      }
      queue._queueBeingFlushed = null;
      if (numberOfQueueItems && after) { after(); }

      if ((priorQueueNameIndex = indexOfPriorQueueWithActions(this, queueNameIndex)) !== -1) {
        queueNameIndex = priorQueueNameIndex;
        continue outerloop;
      }

      queueNameIndex++;
    }
  }
};

function indexOfPriorQueueWithActions(daq, currentQueueIndex) {
  var queueName, queue;

  for (var i = 0, l = currentQueueIndex; i <= l; i++) {
    queueName = daq.queueNames[i];
    queue = daq.queues[queueName];
    if (queue._queue.length) { return i; }
  }

  return -1;
}

export { DeferredActionQueues };
