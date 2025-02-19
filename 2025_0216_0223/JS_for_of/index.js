function forOf(iteratable_obj, callback) {
  const iterator = iteratable_obj[Symbol.iterator]();

  while (true) {
    let result = iterator.next();

    if (result.done) break;

    callback(result.value);
  }
}

const arr = [1, 2, 3, 4, 5];

forOf(arr, value => console.log(value));
