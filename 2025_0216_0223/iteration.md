# [Iteration 迭代协议](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Iteration_protocols)

顾名思义，迭代协议是一种协议。迭代协议的主要目的是为对象定义和定制其迭代行为，从而使得语言能够以统一的方式遍历不同类型的集合。在 Javascript 中，使用的是可迭代协议和迭代器协议允许对象能够在 `for...of...` 循环语法被遍历。并且通过跌代协议，开发者能够自定义对象兼容循环语法。

## [Iterable 可迭代对象](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Iteration_protocols#%E5%8F%AF%E8%BF%AD%E4%BB%A3%E5%8D%8F%E8%AE%AE)

可迭代协议允许 Javascript 对象能够设计或定义其迭代行为。在 Javascript 中一些内置的对象拥有默认的迭代行为。如 Array, Map, Nodelist 等。当然还有其他的对象不满足可迭代协议，因此不具备默认的迭代行为。

对象要满足可迭代协议，其有一定严格的规范。要成为可迭代对象，该对象必须实现 `[Symbol.iterator]()` 方法，这意味着对象（或者它[原型链](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Inheritance_and_the_prototype_chain)上的某个对象）必须有一个键为 `[Symbol.iterator]` 的属性。