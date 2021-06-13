<template>
  <div class="container">
    <div>
      <input type="file" @change="handleFileChange" />
      <el-button @click="handleUpload">上传</el-button>
      <el-button @click="handleResume" v-if="status === statusMap.pause">恢复</el-button>
      <el-button v-else :disabled="status !== statusMap.uploading || !container.hash" @click="handlePause">暂停
      </el-button>
    </div>
    <div>
      <div>计算文件 hash</div>
      <el-progress :percentage="hashPercentage"></el-progress>
      <div>总进度</div>
      <el-progress :percentage="fakeUploadPercentage"></el-progress>
    </div>
    <!-- <div>{{data.length}}--{{cubeWidth}}</div> -->
    <div class="cube-container" :style="{ width: cubeWidth + 'px' }">
      <div class="cube" v-for="chunk in data" :key="chunk.hash">
        <div :class="{
            uploading: chunk.percentage > 0 && chunk.percentage < 100,
            success: chunk.percentage == 100,
            error: chunk.percentage < 0, 
          }" :style="{ height: chunk.percentage + '%' }">
          <i v-if="chunk.percentage > 0 && chunk.percentage < 100" class="el-icon-loading" style="color: #f56c6c"></i>
        </div>
      </div>
    </div>
    <!-- <el-table :data="data">
      <el-table-column
        prop="hash"
        label="切片hash"
        align="center"
      ></el-table-column>
      <el-table-column label="大小(KB)" align="center" width="120">
        <template v-slot="{ row }">
          {{ row.size | transformByte }}
        </template>
      </el-table-column>
      <el-table-column label="进度" align="center">
        <template v-slot="{ row }">
          <el-progress
            :percentage="row.percentage"
            color="#909399"
          ></el-progress>
        </template>
      </el-table-column>
    </el-table> -->
  </div>
</template>

<script>
  import SparkMD5 from "spark-md5";

  const SIZE = 1 * 1024 * 1024; // 切片大小
  const statusMap = {
    wait: "wait",
    pause: "pause",
    uploading: "uploading",
    error: "error",
    done: "done",
  };
  export default {
    data: () => ({
      container: {
        file: null,
      },
      data: [],
      requestList: [],
      hashPercentage: 0,
      statusMap,
      status: statusMap.wait,
      fakeUploadPercentage: 0,
    }),
    watch: {
      uploadPercentage(now) {
        if (now > this.fakeUploadPercentage) {
          this.fakeUploadPercentage = now;
        }
      },
    },
    filters: {
      transformByte(val) {
        return Number((val / 1024).toFixed(0));
      },
    },
    computed: {
      uploadPercentage() {
        if (!this.container.file || !this.data.length) return 0;
        const loaded = this.data
          .map((item) => item.size * item.percentage)
          .reduce((acc, cur) => acc + cur, 0);

        return parseInt((loaded / this.container.file.size).toFixed(2));
      },
      // 方块进度条尽可能的正方形 切片的数量平方根向上取整 控制进度条的宽度
      cubeWidth() {
        return Math.ceil(Math.sqrt(this.data.length)) * 16;
      },
    },
    methods: {
      handleFileChange(e) {
        const file = e.target.files[0];
        if (!file) return;
        this.container.file = file;

        console.log("this.container.file", this.container.file);
      },
      async handleResume() {
        this.status = statusMap.uploading;
        const { uploadedList } = await this.verifyUpload(
          this.container.file.name,
          this.container.hash,
          Math.ceil(this.container.file.size / SIZE),
        );
        await this.uploadChunks(uploadedList);
      },
      handlePause() {
        this.requestList.forEach((xhr) => xhr.abort());
        this.requestList = [];
        this.status = statusMap.pause;
      },
      async handleUpload() {
        if (!this.container.file) return;
        this.status = statusMap.uploading;

        const fileChunkList = this.createFileChunk(this.container.file);
        console.log("fileChunkList", fileChunkList);
        const { name } = this.container.file;
        const [fileName, unit] = name.split(".");
        console.log("handleUpload", fileName, unit);
        console.time("计算哈希耗时");
        // this.container.hash = await this.calculateHash(fileChunkList);
        // this.container.hash = await this.calculateHashIdle(fileChunkList);
        this.container.hash = await this.calculateHashSample();
        console.timeEnd("计算哈希耗时");

        console.log("hash", this.container.hash);
        const { shouldUpload, uploadedList, isNeedMerge } = await this.verifyUpload(
          this.container.file.name,
          this.container.hash,
          Math.ceil(this.container.file.size / SIZE),
        );
        if (!shouldUpload) {
          this.$message.success("秒传：上传成功");
          if (isNeedMerge) {
            this.mergeRequest();
          }
          return;
        }

        this.data = fileChunkList.map(({ file }, index) => {
          const hash = `${this.container.hash}-${index}.${unit}`; // 文件名  数组下标
          return {
            fileHash: this.container.hash,
            chunk: file,
            hash,
            // hash: `${name}-${index}`,
            index,
            size: file.size,
            percentage: uploadedList.includes(hash) ? 100 : 0,
          };
        });
        await this.uploadChunks(uploadedList);
      },
      async handleUpload1() {
        // @todo数据缩放的比率 可以更平缓
        // @todo 并发+慢启动

        // 慢启动上传逻辑
        const file = this.container.file;
        if (!file) return;
        this.status = statusMap.uploading;
        const fileSize = file.size;
        let offset = 1024 * 1024;
        let cur = 0;
        let count = 0;
        this.container.hash = await this.calculateHashSample();

        while (cur < fileSize) {
          // 切割offfset大小
          const chunk = file.slice(cur, cur + offset);
          cur += offset;
          const chunkName = this.container.hash + "-" + count;
          const form = new FormData();
          form.append("chunk", chunk);
          form.append("hash", chunkName);
          form.append("fileName", file.name);
          form.append("fileHash", this.container.hash);
          form.append("size", chunk.size);

          let start = new Date().getTime();
          await this.request({ url: "http://localhost:3000/upload", data: form });
          const now = new Date().getTime();

          const time = ((now - start) / 1000).toFixed(4);
          let rate = time / 30;
          // 速率有最大2和最小0.5
          if (rate < 0.5) rate = 0.5;
          if (rate > 2) rate = 2;
          // 新的切片大小等比变化
          console.log(
            `切片${count}大小是${this.format(offset)} 实际大小是${this.format(
              chunk.size
            )},耗时${time}秒，是30秒的${rate}倍，修正大小为${this.format(
              parseInt(offset / rate)
            )}`
          );
          // 动态调整offset
          offset = parseInt(offset / rate);
          // if(time)
          count++;
        }
      },
      format(num) {
        if (num > 1024 * 1024 * 1024) {
          return (num / (1024 * 1024 * 1024)).toFixed(2) + "GB";
        }
        if (num >= 1024 * 1024) {
          return (num / (1024 * 1024)).toFixed(2) + "MB";
        }
        if (num > 1024) {
          return (num / 1024).toFixed(2) + "KB";
        }
        return num + "B";
      },
      // progress的工厂方法
      createProgressHandler(item) {
        return (e) => {
          const { loaded, total } = e;
          item.percentage = ((loaded / total).toFixed(2) - 0) * 100;
        };
      },
      // 原生req封装
      request({
        url,
        method = "post",
        data,
        headers = {},
        onProgress = (e) => e,
        requestList,
      }) {
        const that = this;
        return new Promise((resolve) => {
          const xhr = new XMLHttpRequest();
          xhr.upload.onprogress = onProgress;
          xhr.open(method, url);
          Object.keys(headers).forEach((key) =>
            xhr.setRequestHeader(key, headers[key])
          );
          xhr.send(data);
          xhr.onload = (e) => {
            // 将请求成功的 xhr 从列表中删除
            if (requestList) {
              const xhrIndex = requestList.findIndex((item) => item === xhr);
              requestList.splice(xhrIndex, 1);
              that.requestList = requestList;
            }
            resolve({
              data: e.target.response,
            });
          };
          // 暴露当前 xhr 给外部
          if (requestList) {
            requestList.push(xhr);
          }

          // console.log("requestList", requestList);
        });
      },
      // 控制并发数
      async sendRequest(forms, max = 4, fn) {
        const that = this;
        console.log("sendRequest this.data", this.data);
        console.log("func", this.createProgresshandler, fn);
        return new Promise((resolve) => {
          const len = forms.length;
          let idx = 0;
          let counter = 0;

          const start = async () => {
            // 有请求，有通道
            while (idx < len && max > 0) {
              max--; // 占用通道
              console.log(idx, "start");
              const form = forms[idx].formData;
              const index = forms[idx].index;
              console.log("index", index, form);
              idx++;
              that
                .request({
                  url: "http://localhost:3000/upload",
                  data: form,
                  onProgress: fn(this.data[index]),
                  requestList: this.requestList,
                })
                .then(() => {
                  max++; // 释放通道
                  counter++;
                  console.log("counter", counter, len);
                  if (counter === len) {
                    resolve();
                  } else {
                    start();
                  }
                });
            }
          };
          start();
        });
      },

      async sendRequestAndErrorRepeat(urls, max = 4, fn) {
        console.log('sendRequestAndErrorRepeat', urls, max)
        urls.map(item => ({
          done: false,
          ...item,
        }))
        return new Promise((resolve) => {
          const len = urls.length - 1;
          // let idx = 0;
          let counter = 0;
          const retryArr = []
          let isAbort = false;
          const start = async () => {

            // 有请求，有通道
            // <= 是因为改了 verifyUpload，有可能存在传入到这里的数组数量为1的情况
            while (counter <= len && max > 0) {
              max--; // 占用通道

              const i = urls.findIndex(v => v.status == statusMap.wait || v.status == statusMap.error)// 等待或者error
              console.log('i', i);
              if (i !== -1) {
                console.log(i, "start");

                urls[i].status = statusMap.uploading
                const form = urls[i].formData;
                const index = urls[i].index;
                if (typeof retryArr[index] == 'number') {
                  console.log(index, '开始重试')
                }
                // if (urls[index].done) {
                //   return;
                // }
                this.request({
                  url: "http://localhost:3000/upload",
                  data: form,
                  onProgress: fn(this.data[index]),
                  requestList: this.requestList
                })
                .then((dataObj) => {
                  if (isAbort) {
                    return;
                  }
                  console.log('function执行完了')
                  const res = JSON.parse(dataObj.data);

                  console.log('then callback', index, res.code, res.message)
                  if (res.code === 0) {
                    urls[i].status = statusMap.done
                    max++; // 释放通道
                    counter++;
                    console.log('counter', counter)
                    // urls[counter].done = true
                    // >= 是因为改了 verifyUpload，有可能存在传入到这里的数组数量为1的情况

                    if (counter >= len) {
                      console.log('counter === len')
                      return resolve();
                    } else {
                      start();
                    }
                  } else {
                    urls[i].status = statusMap.error
                    if (typeof retryArr[index] !== 'number') {
                      retryArr[index] = 0
                    }
                    // 次数累加
                    retryArr[index]++
                    // 一个请求报错3次的
                    if (retryArr[index] >= 3) {
                      isAbort = true;
                      console.log(`abort ${index}, ${JSON.stringify(retryArr)}`);
                      console.log('this.data', this.data);
                      this.data[index].percentage = -1 // 报错的进度条

                      return; // 考虑abort所有别的
                      // urls[i].status = statusMap.done;
                    }
                    // console.log(index, retryArr[index], '次报错')
                    // 3次报错以内的 重启
                    this.data[index].percentage = -1 // 报错的进度条
                    max++; // 释放当前占用的通道，但是counter不累加

                    start()
                  }

                })
                  .catch((err) => {
                    console.log('err', err);
                  })
              }
            }

          }
          start();
        });
      },
      // 生成文件切片
      createFileChunk(file, size = SIZE) {
        const fileChunkList = [];
        let cur = 0;
        while (cur < file.size) {
          fileChunkList.push({ file: file.slice(cur, cur + size) });
          cur += size;
        }
        return fileChunkList;
      },
      // 生成文件 hash（web-worker）
      calculateHash(fileChunkList) {
        return new Promise((resolve) => {
          this.container.worker = new Worker("/hash.js");
          this.container.worker.postMessage({ fileChunkList });
          this.container.worker.onmessage = (e) => {
            const { percentage, hash } = e.data;
            this.hashPercentage = percentage;
            if (hash) {
              resolve(hash);
            }
          };
        });
      },
      // 上传切片
      async uploadChunks(uploadedList = []) {
        const requestList = this.data
          .filter(({ hash }) => !uploadedList.includes(hash))
          .map(({
            chunk, hash, index, fileHash
          }) => {
            const formData = new FormData();
            formData.append("chunk", chunk);
            formData.append("hash", hash);
            formData.append("fileHash", fileHash);
            formData.append("filename", this.container.file.name);
            return { formData, index, status: statusMap.wait };
          });
        // .map(async ({ formData, index }) =>
        //   this.request({
        //     url: "http://localhost:3000",
        //     data: formData,
        //     onProgress: this.createProgressHandler(this.data[index]),
        //     requestList: this.requestList,
        //   })
        // );
        // await Promise.all(requestList); // 并发切片

        await this.sendRequestAndErrorRepeat(requestList, 4, this.createProgressHandler);
        // 之前上传的切片数量 + 本次上传的切片数量 = 所有切片数量时
        // 合并切片
        console.log(
          "上传完了",
          uploadedList.length + requestList.length,
          this.data.length
        );
        // if (uploadedList.length + requestList.length === this.data.length) {
        //   await this.mergeRequest();
        // }
        await this.mergeRequest();
      },
      // 合并切片
      async mergeRequest() {
        await this.request({
          url: "http://localhost:3000/merge",
          headers: {
            "content-type": "application/json",
          },
          data: JSON.stringify({
            size: SIZE,
            fileName: this.container.file.name,
            fileHash: this.container.hash,
          }),
        });
      },

      // requestIdleCallback 计算hash
      async calculateHashIdle(chunks) {
        const that = this;
        return new Promise((resolve) => {
          const spark = new SparkMD5.ArrayBuffer();
          let count = 0;
          // 根据文件内容追加计算
          const appendToSpark = async (file) => {
            return new Promise((resolve) => {
              const reader = new FileReader();
              reader.readAsArrayBuffer(file);
              reader.onload = (e) => {
                spark.append(e.target.result);
                resolve();
              };
            });
          };
          const workLoop = async (deadline) => {
            // 有任务，并且当前帧还没结束
            while (count < chunks.length && deadline.timeRemaining() > 1) {
              await appendToSpark(chunks[count].file);
              count++;
              // 没有了 计算完毕
              if (count < chunks.length) {
                // 计算中
                that.hashPercentage = Number(
                  ((100 * count) / chunks.length).toFixed(2)
                );
                console.log("workLoop hashProgress", this.hashProgress);
              } else {
                // 计算完毕
                that.hashPercentage = 100;
                resolve(spark.end());
              }
            }
            window.requestIdleCallback(workLoop);
          };
          window.requestIdleCallback(workLoop);
        });
      },
      // 抽样hash
      async calculateHashSample() {
        const that = this;
        return new Promise((resolve) => {
          const spark = new SparkMD5.ArrayBuffer();
          const reader = new FileReader();
          const file = this.container.file;
          // 文件大小
          const size = this.container.file.size;
          let offset = 2 * 1024 * 1024;

          let chunks = [file.slice(0, offset)];

          // 前面100K

          let cur = offset;
          while (cur < size) {
            // 最后一块全部加进来
            if (cur + offset >= size) {
              chunks.push(file.slice(cur, cur + offset));
              // 计算完毕
              that.hashPercentage = 100;
            } else {
              // 中间的 前中后去两个字节
              const mid = cur + offset / 2;
              const end = cur + offset;
              chunks.push(file.slice(cur, cur + 2));
              chunks.push(file.slice(mid, mid + 2));
              chunks.push(file.slice(end - 2, end));
              // 计算中
              that.hashPercentage = Number((size / cur).toFixed(2));
            }
            // 前取两个字节
            cur += offset;
          }
          console.log("calculateHashSample", chunks);
          // 拼接
          reader.readAsArrayBuffer(new Blob(chunks));
          reader.onload = (e) => {
            spark.append(e.target.result);

            resolve(spark.end());
          };
        });
      },
      // 根据 hash 验证文件是否曾经已经被上传过
      // 没有才进行上传
      async verifyUpload(fileName, fileHash, fileSplitCount) {
        const { data } = await this.request({
          url: "http://localhost:3000/verify",
          headers: {
            "content-type": "application/json",
          },
          data: JSON.stringify({
            fileName,
            fileHash,
            fileSplitCount,
          }),
        });
        return JSON.parse(data);
      },
    },
  };
</script>
<style scoped>
  .cube-container {
    width: 100px;
    overflow: hidden;
  }

  .cube-container .cube {
    width: 14px;
    height: 14px;
    line-height: 12px;
    border: 1px solid black;
    background: #eee;
    float: left;
  }

  .cube-container .cube>.success {
    background: #67c23a;
  }

  .cube-container .cube>.uploading {
    background: #409eff;
  }

  .cube-container .cube>.error {
    background: #F56C6C;
  }
</style>