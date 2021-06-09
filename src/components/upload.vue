<template>
  <div class="container">
    <div>
      <input type="file" @change="handleFileChange" />
      <el-button @click="handleUpload">上传</el-button>
     <el-button @click="handleResume" v-if="status === statusMap.pause"
        >恢复</el-button
      >
      <el-button
        v-else
        :disabled="status !== statusMap.uploading || !container.hash"
        @click="handlePause"
        >暂停</el-button
      >
    </div>
    <div>
      <div>计算文件 hash</div>
      <el-progress :percentage="hashPercentage"></el-progress>
      <div>总进度</div>
      <el-progress :percentage="fakeUploadPercentage"></el-progress>
    </div>

    <div class="cube-container" :style="{width:cubeWidth+'px'}">
    <div class="cube" 
      v-for="chunk in data" 
      :key="chunk.hash">
      <div           
        :class="{
        'uploading':chunk.percentage>0&&chunk.percentage<100, 
        'success':chunk.percentage==100
        }" 
        :style="{height:chunk.percentage+'%'}"
        >
        
        <i v-if="chunk.percentage>0&&chunk.percentage<100" class="el-icon-loading" style="color:#F56C6C;"></i>
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
import SparkMD5 from 'spark-md5';

const SIZE = 5 * 1024 * 1024; // 切片大小
const statusMap = {
  wait: "wait",
  pause: "pause",
  uploading: "uploading",
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
    fakeUploadPercentage: 0
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
    cubeWidth(){
      return Math.ceil(Math.sqrt(this.data.length))*16
    },
  },
  methods: {
    async handleResume() {
      this.status = statusMap.uploading;
      const { uploadedList } = await this.verifyUpload(
        this.container.file.name,
        this.container.hash
      );
      await this.uploadChunks(uploadedList);
    },
    handlePause() {
      this.requestList.forEach((xhr) => xhr.abort());
      this.requestList = [];
      this.status = statusMap.pause;
    },
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
    async sendRequest(forms, max = 4, fn) {
      const that = this;
      console.log('sendRequest this.data', this.data);
      console.log('func', this.createProgresshandler, fn)
      return new Promise(resolve => {
        const len = forms.length;
        let idx = 0;
        let counter = 0;

        const start = async ()=> {
          // 有请求，有通道
          while (idx < len && max > 0) {
            max--; // 占用通道
            console.log(idx, "start");
            const form = forms[idx].formData;
            const index = forms[idx].index;
            console.log('index', index, form);
            idx++
            that.request({
              url: "http://localhost:3000",
              data: form,
              onProgress: fn(this.data[index]),
              requestList: this.requestList
            }).then(() => {
              max++; // 释放通道
              counter++;
              console.log('counter', counter, len);
              if (counter === len) {
                resolve();
              } else {
                start();
              }
            });
          }
        }
        start();
      });
    },

    handleFileChange(e) {
      const file = e.target.files[0];
      if (!file) return;
      this.container.file = file;

      console.log("this.container.file", this.container.file);
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
    // 上传切片
    async uploadChunks(uploadedList = []) {
      const requestList = this.data
        .filter(({ hash }) => !uploadedList.includes(hash))
        .map(({ chunk, hash, index, fileHash }) => {
          const formData = new FormData();
          formData.append("chunk", chunk);
          formData.append("hash", hash);
          formData.append("fileHash", fileHash);
          formData.append("filename", this.container.file.name);
          return { formData, index };
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
      


      await this.sendRequest(requestList, 4, this.createProgressHandler)
      // 之前上传的切片数量 + 本次上传的切片数量 = 所有切片数量时
      // 合并切片
      console.log('上传完了', uploadedList.length + requestList.length, this.data.length)
      if (uploadedList.length + requestList.length === this.data.length) {
        await this.mergeRequest();
      }
      // await this.mergeRequest();
    },
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
    // requestIdleCallback 计算hash
    async calculateHashIdle(chunks) {
      const that = this;
      return new Promise(resolve => {
        const spark = new SparkMD5.ArrayBuffer();
        let count = 0;
        // 根据文件内容追加计算
        const appendToSpark = async file => {
          return new Promise(resolve => {
            const reader = new FileReader();
            reader.readAsArrayBuffer(file);
            reader.onload = e => {
              spark.append(e.target.result);
              resolve();
            };
          });
        };
        const workLoop = async deadline => {
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
              console.log('workLoop hashProgress', this.hashProgress)
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
      return new Promise(resolve => {
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
            that.hashPercentage = Number(
              (size / cur).toFixed(2)
            );
          }
          // 前取两个字节
          cur += offset;
        }
        console.log('calculateHashSample', chunks)
        // 拼接
        reader.readAsArrayBuffer(new Blob(chunks));
        reader.onload = e => {
          spark.append(e.target.result);

          resolve(spark.end());
        };
      });
    },
    async handleUpload() {
      if (!this.container.file) return;
      this.status = statusMap.uploading;

      const fileChunkList = this.createFileChunk(this.container.file);
      console.log("fileChunkList", fileChunkList);
      const { name } = this.container.file;
      const [fileName, unit] = name.split(".");
      console.log("handleUpload", fileName, unit);
      console.time('计算哈希耗时');
      // this.container.hash = await this.calculateHash(fileChunkList);
      // this.container.hash = await this.calculateHashIdle(fileChunkList);
      this.container.hash = await this.calculateHashSample();
      console.timeEnd('计算哈希耗时');

      console.log('hash', this.container.hash);
      const { shouldUpload, uploadedList } = await this.verifyUpload(
        this.container.file.name,
        this.container.hash
      );
      if (!shouldUpload) {
        this.$message.success("秒传：上传成功");
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
    createProgressHandler(item) {
      return (e) => {
        const { loaded, total } = e;
        item.percentage = ((loaded / total).toFixed(2) - 0) * 100;
      };
    },
    // 根据 hash 验证文件是否曾经已经被上传过
    // 没有才进行上传
    async verifyUpload(fileName, fileHash) {
      const { data } = await this.request({
        url: "http://localhost:3000/verify",
        headers: {
          "content-type": "application/json",
        },
        data: JSON.stringify({
          fileName,
          fileHash,
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
  background: #67C23A;
}
.cube-container .cube>.uploading {
  background: #409EFF;
}

</style>