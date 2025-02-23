# 比特币中的哈希机制

## 哈希函数（密码学）

<ul>
<li><a href="https://en.wikipedia.org/wiki/Collision_resistance"> collision resistance
</a></li>
简单来讲,其实就是避免两个函数输入值<strong>x</strong>和<strong>y</strong>,经过哈希函数计算后产生的输出值不一样。不过不能使用数学上来解释哈希函数为何能够满足这一特性，是一种经验来说明某种函数具有<strong>collision resistance</strong>性质。具体的数学解释点击<a href="https://en.wikipedia.org/wiki/Collision_resistance">
here</a>
<li>hiding</li>
输入值<strong>x</strong>经过哈希函数<strong>H(x)</strong>计算后输出得到<strong>hash</strong>值，无法通过<strong>hash</strong>值推出其输入值。前提是当输入值足够多并且输入值当取值分布比较均匀才能满足这一特征。当然可以使用蛮力来破解，遍历所有输入值进行哈希函数计算得出的值与想进行匹配的哈希值进行匹配来破解。但是工程量特别繁杂的，还是算了吧。
<li><a href="https://en.wikipedia.org/wiki/Puzzle_friendliness">
puzzle friendly
</a></li>
谜题友好，很难从字面意思上进行理解，但是完全能够使用通俗易懂的语言对其进行解释。

我们无法通过预测一个值输入哈希函数后得到的结果是如何，不能够进行人为干扰。比如：我想得到一个十六位的哈希值，其前八位全为 0 ，后八位随意。这一点是不可能实现的，犹如生死，无法人为的干预，只能够听天由命。（哈哈
</ul>
  
## 比特币中的哈希函数

比特币点对点电子货币系统使用的哈希函数是[SHA_256(secure hash algorithm)](https://www.movable-type.co.uk/scripts/sha256.html)。输入给 SHA-256 的消息首先会被处理生成一个 256 位的散列值（即32字节），然后这个散列值会被转化为一个以16进制表示的字符串。每个字节在16进制中用两个字符表示，因此最终得到的哈希值在文本表示中会是64个字符长。


