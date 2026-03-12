// const promiseAll = (taskList) => {
//     const res = []
//     for (let i = 0; i < taskList.length; i++) {
//         new Promise((resolve, reject) => {
//             taskList[i]()
//         })
//             .then((val) => res.push(val))
//             .catch(err => console.error(err))
//     }
//     return new Promise(res)
// }
const promiseAll = (taskList) => {
    return new Promise((resolve, reject) => {
        const res = []
        let count = 0
        for (let i = 0; i < taskList.length; i++) {
            taskList[i]
                .then((val) => {
                    res[i] = val // 按下标寸，保证顺序，res.push 不能保证顺序
                    count++
                    if (count === taskList.length) resolve(res) // 如果 count 等于 taskList.length 就直接 resolve
                })
                .catch((err) => reject(err))
        }
    })
}