# [Iteration ����Э��](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Iteration_protocols)

����˼�壬����Э����һ��Э�顣����Э�����ҪĿ����Ϊ������Ͷ����������Ϊ���Ӷ�ʹ�������ܹ���ͳһ�ķ�ʽ������ͬ���͵ļ��ϡ��� Javascript �У�ʹ�õ��ǿɵ���Э��͵�����Э����������ܹ��� `for...of...` ѭ���﷨������������ͨ������Э�飬�������ܹ��Զ���������ѭ���﷨��

## [Iterable �ɵ�������](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Iteration_protocols#%E5%8F%AF%E8%BF%AD%E4%BB%A3%E5%8D%8F%E8%AE%AE)

�ɵ���Э������ Javascript �����ܹ���ƻ����������Ϊ���� Javascript ��һЩ���õĶ���ӵ��Ĭ�ϵĵ�����Ϊ���� Array, Map, Nodelist �ȡ���Ȼ���������Ķ�������ɵ���Э�飬��˲��߱�Ĭ�ϵĵ�����Ϊ��

����Ҫ����ɵ���Э�飬����һ���ϸ�Ĺ淶��Ҫ��Ϊ�ɵ������󣬸ö������ʵ�� `[Symbol.iterator]()` ����������ζ�Ŷ��󣨻�����[ԭ����](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Inheritance_and_the_prototype_chain)�ϵ�ĳ�����󣩱�����һ����Ϊ `[Symbol.iterator]` �����ԡ�