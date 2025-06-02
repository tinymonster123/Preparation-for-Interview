function Obj() {
  this.func = function () {alert(1)};
  this.obj={a:1};
  this.arr = [1,2,3];
  this.und = undefined;
  this.reg=/123/;
  this.date = new Date(0);
  this.NaN = NaN;
  this.infinity = Infinity;
  this.sym = Symbol(1);
}

let obj1 = new Obj();
Object.defineProperty(obj1, 'innumerable', {
  enumerable: false,
  value: 'innumerable'
});

console.log('obj1', obj1);
let str = JSON.stringify(obj1);
let obj2 = JSON.parse(str);
console.log('obj2', obj2);