# [Iteration 迭代协议](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Iteration_protocols)

顾名思义，迭代协议是一种协议。迭代协议的主要目的是为对象定义和定制其迭代行为，从而使得语言能够以统一的方式遍历不同类型的集合。在 Javascript 中，使用的是可迭代协议和迭代器协议允许对象能够在 `for...of...` 循环语法被遍历。并且通过跌代协议，开发者能够自定义对象兼容循环语法。

## [Iterable 可迭代对象](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Iteration_protocols#%E5%8F%AF%E8%BF%AD%E4%BB%A3%E5%8D%8F%E8%AE%AE)

可迭代协议允许 Javascript 对象能够设计或定义其迭代行为。在 Javascript 中一些内置的对象拥有默认的迭代行为。如 Array, Map, Nodelist 等。当然还有其他的对象不满足可迭代协议，因此不具备默认的迭代行为。

对象要满足可迭代协议，其有一定严格的规范。要成为可迭代对象，该对象必须实现 `[Symbol.iterator]()` 方法，这意味着对象（或者它[原型链](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Inheritance_and_the_prototype_chain)上的某个对象）必须有一个键为 `[Symbol.iterator]` 的属性。

当一个对象需要被迭代的时候（比如被置入一个 `for...of` 循环时），首先，会不带参数调用它的 `[Symbol.iterator]()` 方法(`Symbol.iterator`是一个无参函数)，然后使用此方法返回的迭代器获得要迭代的值。

值得注意的是调用此无参数函数时，它将作为对可迭代对象的方法进行调用。因此，在函数内部，this 关键字可用于访问可迭代对象的属性，以决定在迭代过程中提供什么。

使用代码对上面这段话进行解释：

```javascript
const myItems = {
  item: [1, 2, 3],
  [Symbol.iterator]() {
    let index = 0;
    return {
      //注意箭头函数和普通函数 this 指向的问题
      next: () => {
        if (index < this.item.length) {
          // 返回迭代器
          return { value: this.item[index++], done: false };
        } else {
          return { done: true };
        }
      },
    };
  },
};

//for...of...能够无参调用可迭代对象的 [Symbol.iterator]() 方法
for (const value of myItems) {
  console.log(value);
}
```

## [迭代器协议](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Iteration_protocols#%E8%BF%AD%E4%BB%A3%E5%99%A8%E5%8D%8F%E8%AE%AE)

只有实现了一个拥有以下语义（semantic）的 `next()` 方法，一个对象才能成为迭代器：

### `next()`

无参数或者接受一个参数的函数，并返回符合 `IteratorResult `接口的对象（见下文）。如果在使用迭代器内置的语言特征（例如 `for...of`）时，得到一个非对象返回值（例如 `false` 或 `undefined`），将会抛出 `TypeError`（`"iterator.next() returned a non-object value"`）。

所有迭代器协议的方法（`next()`、`return()` 和 `throw()`）都应返回实现 `IteratorResult `接口的对象。它必须有以下属性：

#### `value`(可选)

迭代器返回的任何 `JavaScript` 值。`done` 为 `true`时可省略。

实际上，两者都不是严格要求的；如果返回没有任何属性的对象，则实际上等价于 `{ done: false, value: undefined }`。

如果一个迭代器返回一个 `done: true` 的结果，则对任何 `next()` 的后续调用也返回 `done: true`，尽管这在语言层面不是强制的。

next 方法可以接受一个值，该值将提供给方法体。任何内置的语言特征都将不会传递任何值。传递给生成器 `next` 方法的值将成为相应 `yield` 表达式的值。

#### `done`（可选）

如果迭代器能够生成序列中的下一个值，则返回 `false` 布尔值。（这等价于没有指定 `done` 这个属性。）

如果迭代器已将序列迭代完毕，则为 `true`。这种情况下，`value` 是可选的，如果它依然存在，即为迭代结束之后的默认返回值。


暂时这样吧，感觉还有很多如异步迭代器之类的语法规范，先不写了。但是通过迭代协议对`for...of...`的理解加深了很多。