const fse = require("fs-extra")
const path = require('path')
const UPLOAD_DIR = path.resolve(__dirname, "target"); // 大文件存储目录

const resolvePost = req => {
  return new Promise(resolve => {
    let chunk = "";
    req.on("data", data => {
     chunk += data;
    });
    req.on("end", () => {
      console.log('resolvePost chunk', chunk)
      resolve(JSON.parse(chunk));
    });
  });
 }
 
const pipeStream = (path, writeStream) => new Promise(resolve => {
  const readStream = fse.createReadStream(path);
  readStream.pipe(writeStream);
  readStream.on("end", () => {
    console.log(`${path} end`)
    fse.unlinkSync(path);
    resolve();
  });
  readStream.pipe(writeStream);
});


// 返回已经上传切片名
const createUploadedList = async fileHash =>
  fse.existsSync(path.resolve(UPLOAD_DIR, fileHash))
    ? await fse.readdir(path.resolve(UPLOAD_DIR, fileHash))
    : [];

  const extractExt = fileName => fileName.slice(fileName.lastIndexOf("."));  // 提取后缀名
  module.exports = {
    resolvePost,
    pipeStream,
    createUploadedList,
    extractExt,
  }