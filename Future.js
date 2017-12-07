
class Future {

  constructor(computation) {
    this._computation = computation;
  }

  fork(rejecter, resolver) {
    return this._computation(rejecter, resolver);
  }

  map(fn) {
    const computation = this._computation;
    return new Future((rejecter, resolver) => {
      return computation(rejecter, x => resolver(fn(x)));
    });
  }

  chain(fn) {
    const computation = this._computation;
    return new Future((rejecter, resolver) => {
      return computation(rejecter, x => fn(x).fork(rejecter, resolver));
    });
  }

  ap(other) {
    const computation = this._computation;
    return new Future((rejecter, resolver) => {
      return other.fork(rejecter, val => {
        if (typeof val === 'function') {
          return computation(rejecter, x => resolver(val(x)));
        }
        return computation(rejecter, fn => resolver(fn(val)));
      });
    });
  }

  cache() {
    const computation = this._computation;
    return new CachedFuture((rejecter, resolver) => {
      return computation(rejecter, resolver);
    });
  }

}

class CachedFuture extends Future {

  constructor(computation) {
    super(computation);
    this._cancelation = undefined;
    this._state = 'pending';
    this._queue = [];
    this._cancelationQueue = [];
  }

  releaseMemory() {
    this._cancelation =
    this._cache =
    this._computation = undefined;
    this._cancelationQueue = [];
    this._queue = [];
    this._state = 'pending';
  }

  fork(rejecter, resolver) {

    if (this._state === 'running') {
      const forkID = this._addToQueue(rejecter, resolver);
      return () => this._cancelationQueue.push(forkID);
    }

    if (this._state === 'rejected') {
      rejecter(this._cache);
      return this._cancelation;
    }

    if (this._state === 'resolved') {
      resolver(this._cache);
      return this._cancelation;
    }

    this._state = 'running';

    const hijack = state => val => {
      this._state = state;
      this._cache = val;
      this._processQueue(val, state);
    };

    this._cancelation = this._computation(
      hijack('rejected'),
      hijack('resolved')
    );

    this._addToQueue(rejecter, resolver);
    //
    // if cancelationqueue === forkqueue, call cancel!!!
    //
    return () => this._cancelationQueue.push(0);
  }

  _addToQueue(rej, res) {
    return this._queue.push([rej, res]) - 1;
  }

  _processQueue(val, state) {
    this._queue
      .filter((fork, i) => this._cancelationQueue.indexOf(i) < 0)
      .map(([a, b]) => (state === 'rejected') ? a : b)
      .map(fn => fn(val));

    this._queue = [];
    this._cancelationQueue = [];
  }

}

Future.of = Future.resolve = value => new CachedFuture((_, resolver) => resolver(value));
Future.reject = value => new CachedFuture(rejecter => rejecter(value));

Future.after = (time, value) => new Future((_, resolver) => {
  const t = setTimeout(resolver, time, value);
  return () => clearTimeout(t);
});

Future.all = (futures) => {
  return new Future((rejecter, resolver) => {
    const total = futures.length;
    let results = Array(total);
    let count = 0;

    const resolverMaker = index => result => {
      results[index] = result;
      if (++count === total) {
        resolver(results);
      }
    };

    const cancelations = futures.map((future, i) =>
      future.fork(rejecter, resolverMaker(i))
    );

    return () => cancelations.map(fn => fn());
  });
};


const f = Future.after(2000, 10).cache();

f.fork(console.error, console.log)();
f.map(x => x + 1).fork(console.error, console.log)();
f.map(x => x * x).fork(console.error, console.log)();