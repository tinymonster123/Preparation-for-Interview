// 红灯 3s 亮一次，绿灯 1s 亮一次，黄灯 2s 亮一次；如何让三个灯不断交替重复亮灯？

const light = (color, duration) => new Promise((res) => {
    // 不要写成 setTimeout(res(),duration) 不然就是同步执行了
    // setTimeout(res(), 1000)
    // 等价于分两步看：
    // 第一步：求值参数
    // const arg = res()   // ← res 在这里就被调用了！Promise 已经 resolve
    // 第二步：把求值结果传给 setTimeout
    // setTimeout(undefined, 1000)  // 1秒后执行 undefined，什么都不会发生
    // JS 的参数是"传值"的 — 传入函数前，表达式会先被求值。
    // fn(a()) 永远是先执行 a()，再把结果传给 fn。
    setTimeout(res, duration)
    console.log(`${color}灯亮了`)
})

const trafficLight = async () => {
    while (true) {
        // 串行 await
        // 先执行 light(red)
        // 挂起 trafficLight
        // 3s 后 resolve() 触发，恢复 trafficLight 继续往下执行
        // 循环往复
        await light("red", 3000)
        await light("green", 1000)
        await light("yellow", 2000)
    }
}

trafficLight()