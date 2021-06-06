<template>
  <div class="container">
      <div>
        <input type="file" @change="handleFileChange" />
        <el-button @click="handleUpload">上传</el-button>
      </div>
    <div>
      <div>计算文件 hash</div>
      <!-- <el-progress :percentage="hashPercentage"></el-progress> -->
      <div>总进度</div>
      <el-progress :percentage="uploadPercentage"></el-progress>
    </div>
    <el-table :data="data">
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
    </el-table>
  </div>
</template>

<script>
const SIZE = 10 * 1024 * 1024; // 切片大小

export default {
  data: () => ({
    container: {
      file: null,
    },

    data: [],
    requestList: [],
  }),
  watch: {
    data(nv) {
      console.log('监听', nv);
    }
  },
  filters: {
    transformByte(val) {
      return Number((val / 1024).toFixed(0));
    }
  },
  computed: {
    uploadPercentage() {
        if (!this.container.file || !this.data.length) return 0;
        const loaded = this.data
          .map(item => item.size * item.percentage)
          .reduce((acc, cur) => acc + cur, 0);

      return parseInt((loaded / this.container.file.size).toFixed(2));
    },
  },
  methods: {
    request({
      url,
      method = "post",
      data,
      headers = {},
      onProgress = e => e,  
      // requestList
    }) {
      return new Promise((resolve) => {
        const xhr = new XMLHttpRequest();
        xhr.upload.onprogress = onProgress;
        xhr.open(method, url);
        Object.keys(headers).forEach((key) =>
          xhr.setRequestHeader(key, headers[key])
        );
        xhr.send(data);
        xhr.onload = (e) => {
          resolve({
            data: e.target.response,
          });
        };
      });
    },
    handleFileChange(e) {
      const file = e.target.files[0]
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
    async uploadChunks() {
      const requestList = this.data
        .map(({ chunk, hash, index }) => {
          const formData = new FormData();
          formData.append("chunk", chunk);
          formData.append("hash", hash);
          formData.append("filename", this.container.file.name);
          return { formData, index };
        })
        .map(async ({ formData, index }) =>
          this.request({
            url: "http://localhost:3000",
            data: formData,
           onProgress: this.createProgressHandler(this.data[index]),
          })
        );
      await Promise.all(requestList); // 并发切片
      // 合并切片
      await this.mergeRequest();
    },
    async mergeRequest() {
      await this.request({
        url: "http://localhost:3000/merge",
        headers: {
          "content-type": "application/json",
        },
        data: JSON.stringify({
          size: SIZE,
          filename: this.container.file.name,
        }),
      });
    },
    async handleUpload() {
      if (!this.container.file) return;
      const fileChunkList = this.createFileChunk(this.container.file);
      console.log("fileChunkList", fileChunkList);
      const { name } = this.container.file;
      const [fileName, unit] = name.split('.');
      console.log('handleUpload', fileName, unit)
      this.data = fileChunkList.map(({ file }, index) => ({
        chunk: file,
        hash: `${fileName}-${index}.${unit}`, // 文件名  数组下标
        // hash: `${name}-${index}`,
        percentage: 0,
        index,
        size: file.size,
      }));

      await this.uploadChunks();
    },
    createProgressHandler(item) {
      return e => {
        const { loaded, total } = e;
        item.percentage = (loaded / total) * 100;
     };
    },
  },
};
</script>
