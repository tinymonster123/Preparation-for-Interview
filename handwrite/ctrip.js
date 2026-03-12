// 设计一个sendRequest函数，可以限制多个请求的并发处理，同一时间只能处理指定数量的请求。
// 同时在所有请求结束之后，调用callback函数，在callback函数内可以拿到各个请求的返回值

// 请求数组
const requestList = [
    () => request("接口1", 3),
    () => request("接口2", 1),
    () => request("接口3", 4),
    () => request("接口4", 4),
    () => request("接口5", 2),
];
// 并发数
const limit = 3;
// 回调函数，res 为 返回值的数组，类似于 Promise.all 的返回值
const callback = (res) => console.log(res); // 输出 ["成功", "失败", "失败", "成功", "成功"]

// 接口请求函数request已经定义好，可以直接使用：在指定的时间以后，会随机返回成功或者失败的Promise
function request(url, time = 1) {
    return new Promise((resolve, reject) => {
        setTimeout(() => {
            if (Math.random() > 0.5) {
                const result = url + "请求结束: 成功";
                console.log(result);
                resolve("成功");
            } else {
                const result = url + "请求结束: 失败";
                console.log(result);
                reject("失败");
            }
        }, time * 1000);
    });
}

function sendRequest(requestList, limit, callback) {
    // 请补充代码
    const res = new Array(request.length)
    let running = 0
    let index = 0
    const run = () => {
        if(index >= requestList.length) return
        const tempIdx = index++
        const task = requestList[tempIdx]
        task()
            .then(val => res[tempIdx] = val)
            .catch(err => res[tempIdx] = err)
            .finally(() => {
                running++
                if(index < requestList.length) run()
                if(running === requestList.length) callback(res)
            })
    }
    const startIdx = Math.min(limit,requestList.length)
    for(let i = 0;i < startIdx;i++){
        run()
    }
}

sendRequest(requestList, limit, callback);