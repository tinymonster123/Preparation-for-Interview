# [Iteration ����Э��](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Iteration_protocols)

����˼�壬����Э����һ��Э�顣����Э�����ҪĿ����Ϊ������Ͷ����������Ϊ���Ӷ�ʹ�������ܹ���ͳһ�ķ�ʽ������ͬ���͵ļ��ϡ��� Javascript �У�ʹ�õ��ǿɵ���Э��͵�����Э����������ܹ��� `for...of...` ѭ���﷨������������ͨ������Э�飬�������ܹ��Զ���������ѭ���﷨��

## [Iterable �ɵ�������](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Iteration_protocols#%E5%8F%AF%E8%BF%AD%E4%BB%A3%E5%8D%8F%E8%AE%AE)

�ɵ���Э������ Javascript �����ܹ���ƻ����������Ϊ���� Javascript ��һЩ���õĶ���ӵ��Ĭ�ϵĵ�����Ϊ���� Array, Map, Nodelist �ȡ���Ȼ���������Ķ�������ɵ���Э�飬��˲��߱�Ĭ�ϵĵ�����Ϊ��

����Ҫ����ɵ���Э�飬����һ���ϸ�Ĺ淶��Ҫ��Ϊ�ɵ������󣬸ö������ʵ�� `[Symbol.iterator]()` ����������ζ�Ŷ��󣨻�����[ԭ����](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Inheritance_and_the_prototype_chain)�ϵ�ĳ�����󣩱�����һ����Ϊ `[Symbol.iterator]` �����ԡ�

��һ��������Ҫ��������ʱ�򣨱��类����һ�� `for...of` ѭ��ʱ�������ȣ��᲻�������������� `[Symbol.iterator]()` ����(`Symbol.iterator`��һ���޲κ���)��Ȼ��ʹ�ô˷������صĵ��������Ҫ������ֵ��

ֵ��ע����ǵ��ô��޲�������ʱ��������Ϊ�Կɵ�������ķ������е��á���ˣ��ں����ڲ���this �ؼ��ֿ����ڷ��ʿɵ�����������ԣ��Ծ����ڵ����������ṩʲô��

ʹ�ô����������λ����н��ͣ�

```javascript
const myItems = {
  item: [1, 2, 3],
  [Symbol.iterator]() {
    let index = 0;
    return {
      //ע���ͷ��������ͨ���� this ָ�������
      next: () => {
        if (index < this.item.length) {
          // ���ص�����
          return { value: this.item[index++], done: false };
        } else {
          return { done: true };
        }
      },
    };
  },
};

//for...of...�ܹ��޲ε��ÿɵ�������� [Symbol.iterator]() ����
for (const value of myItems) {
  console.log(value);
}
```

## [������Э��](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Iteration_protocols#%E8%BF%AD%E4%BB%A3%E5%99%A8%E5%8D%8F%E8%AE%AE)

ֻ��ʵ����һ��ӵ���������壨semantic���� `next()` ������һ��������ܳ�Ϊ��������

### `next()`

�޲������߽���һ�������ĺ����������ط��� `IteratorResult `�ӿڵĶ��󣨼����ģ��������ʹ�õ��������õ��������������� `for...of`��ʱ���õ�һ���Ƕ��󷵻�ֵ������ `false` �� `undefined`���������׳� `TypeError`��`"iterator.next() returned a non-object value"`����

���е�����Э��ķ�����`next()`��`return()` �� `throw()`����Ӧ����ʵ�� `IteratorResult `�ӿڵĶ������������������ԣ�

#### `value`(��ѡ)

���������ص��κ� `JavaScript` ֵ��`done` Ϊ `true`ʱ��ʡ�ԡ�

ʵ���ϣ����߶������ϸ�Ҫ��ģ��������û���κ����ԵĶ�����ʵ���ϵȼ��� `{ done: false, value: undefined }`��

���һ������������һ�� `done: true` �Ľ��������κ� `next()` �ĺ�������Ҳ���� `done: true`�������������Բ��治��ǿ�Ƶġ�

next �������Խ���һ��ֵ����ֵ���ṩ�������塣�κ����õ����������������ᴫ���κ�ֵ�����ݸ������� `next` ������ֵ����Ϊ��Ӧ `yield` ���ʽ��ֵ��

#### `done`����ѡ��

����������ܹ����������е���һ��ֵ���򷵻� `false` ����ֵ������ȼ���û��ָ�� `done` ������ԡ���

����������ѽ����е�����ϣ���Ϊ `true`����������£�`value` �ǿ�ѡ�ģ��������Ȼ���ڣ���Ϊ��������֮���Ĭ�Ϸ���ֵ��


��ʱ�����ɣ��о����кܶ����첽������֮����﷨�淶���Ȳ�д�ˡ�����ͨ������Э���`for...of...`���������˺ܶࡣ