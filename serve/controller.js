const path = require("path");
const fse = require("fs-extra");
const multiparty = require("multiparty");
const utils = require('./utils');

const extractExt = utils.extractExt;
const resolvePost = utils.resolvePost;
const pipeStream = utils.pipeStream;
const createUploadedList = utils.createUploadedList;
const SIZE = 1 * 1024 * 1024; // 切片大小

class Controller {
  constructor(uploadDir) {
    this.UPLOAD_DIR = uploadDir
  }
  async handleVerify(req, res) {
    const data = await resolvePost(req);
    const { fileHash, fileName, fileSplitCount } = data;
    console.log('verify', fileHash, this.UPLOAD_DIR)
    console.log('file split count', fileSplitCount)
    const filePath = path.resolve(this.UPLOAD_DIR, `${fileHash}${extractExt(fileName)}`);
    const fileDirPath = path.resolve(this.UPLOAD_DIR, `${fileHash}`);
    console.log('verify filePath', filePath, fileDirPath)
    const hasFileDirPath =  fse.existsSync(fileDirPath);
    const crtUploadList = await createUploadedList(fileHash);
    const isNeedMerge = !fse.existsSync(filePath);
    console.log('verify has upload list', crtUploadList)
    res.end(
      JSON.stringify({
        shouldUpload: hasFileDirPath ? (crtUploadList.length !== fileSplitCount) : true,
        uploadedList: hasFileDirPath ? crtUploadList : [],
        isNeedMerge: isNeedMerge,
      })
    );
  }
  async handleUpload(req, res) {
    const multipart = new multiparty.Form();
    multipart.parse(req, async (err, fields, files) => {
      if (err) {
        return;
      }
      if(Math.random() < 0.2){
        // 概率报错
        console.log('概率报错了')
        res.statusCode=500
        res.end(JSON.stringify({
          code: -1,
          message: 'upload fail'
        }))
        return 
      }
      const [chunk] = files.chunk;
      const [hash] = fields.hash;
      const [fileHash] = fields.fileHash;
      const chunkDir = path.resolve(this.UPLOAD_DIR, fileHash.split('.')[0]);
      console.log('文件名', hash)
      // 切片目录不存在，创建切片目录
      if (!fse.existsSync(chunkDir)) {
        await fse.mkdirs(chunkDir);
      }
  
      // fs-extra 专用方法，类似 fs.rename 并且跨平台
      // fs-extra 的 rename 方法 windows 平台会有权限问题
      // https://github.com/meteor/meteor/issues/7852#issuecomment-255767835
      const filePath =  path.resolve(chunkDir, hash);
      console.log('移动到该目录下', filePath);

      if (!fse.existsSync(filePath))
      await fse.move(chunk.path, filePath);
      res.end(
        JSON.stringify({
          code: 0,
          message: "success"
        })
      );
    });
  }
  async handleMerge(req, res) {
    const data = await resolvePost(req);
    console.log('data', data);
    const { fileHash, fileName } = data;
    console.log('/merge fileHash', fileHash)
    const filePath = path.resolve(this.UPLOAD_DIR, `${fileHash}${extractExt(fileName)}`);
    console.log('/merge filePath', filePath)

    await this.mergeFileChunk(filePath, fileHash);
    res.end(
      JSON.stringify({
        code: 0,
        message: "file merged success"
      })
    );
  }
  // 合并切片
  async mergeFileChunk (filePath, fileHash, size = SIZE) { 
   const chunkDir = path.resolve(this.UPLOAD_DIR, `${fileHash}`);
    console.log('mergeFileChunk chunkDir', chunkDir);
    const readKey = '读取目录';
    const starMergekey = '开始合并';
    console.time(readKey);
    const chunkPaths = await fse.readdir(chunkDir); 
    console.timeEnd(readKey);
    // 根据切片下标进行排序
    // 否则直接读取目录的获得的顺序可能会错乱
    chunkPaths.sort((a, b) => a.split("-")[1] - b.split("-")[1]);
    console.time(starMergekey);
    const fileSuffix = extractExt(filePath).slice(1);
    console.log('开始合并 >>>>>>>>>', JSON.stringify(chunkPaths));
    console.log('文件后缀', fileSuffix);
    // if (fileSuffix === 'mp4') {
      
    // } else {
    //   await Promise.all(
    //     chunkPaths.map((chunkPath, index) => {
    //       console.log('创建流文件', index * size)
    //       return pipeStream(
    //         path.resolve(chunkDir, chunkPath),
    //         // 指定位置创建可写流
    //         fse.createWriteStream(filePath, {
    //           start: index * size,
    //           end: (index + 1) * size
    //         })
    //       );
    //     })
    //   );
    //   console.timeEnd(starMergekey);
    //   console.log('合并完成');
  
    //   fse.rmdirSync(chunkDir); // 合并后删除保存切片的目录
    // }
    await Promise.all(
      chunkPaths.map((chunkPath, index) => {
        console.log('创建流文件', index * size)
        return pipeStream(
          path.resolve(chunkDir, chunkPath),
          // 指定位置创建可写流
          fse.createWriteStream(filePath, {
            start: index * size,
            end: (index + 1) * size
          })
        );
      })
    );
    console.timeEnd(starMergekey);
    console.log('合并完成');
  
    fse.rmdirSync(chunkDir); // 合并后删除保存切片的目录
  };
  
}
module.exports = Controller
