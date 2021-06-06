const http = require("http");
const path = require("path");
const fse = require("fs-extra");
const multiparty = require("multiparty");

const server = http.createServer();

const extractExt = filename =>
  filename.slice(filename.lastIndexOf("."), filename.length); // 提取后缀名
const UPLOAD_DIR = path.resolve(__dirname, "target"); // 大文件存储目录

const SIZE = 10 * 1024 * 1024; // 切片大小

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

// 合并切片
 const mergeFileChunk = async (filePath, filename, size = SIZE) => {
   
  const chunkDir = path.resolve(UPLOAD_DIR, filename.split('.')[0]);
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
  console.log('开始合并', JSON.stringify(chunkPaths));
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


server.on("request", async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  if (req.method === "OPTIONS") {
    res.status = 200;
    res.end();
    return;
  }
     if (req.url === "/merge") {
         const data = await resolvePost(req);
         console.log('data', data);
         const { filename,size } = data;
         console.log('/merge filename', filename)
         const filePath = path.resolve(UPLOAD_DIR, `${filename}`);
         console.log('/merge filePath', filePath)

         await mergeFileChunk(filePath, filename);
         res.end(
           JSON.stringify({
             code: 0,
             message: "file merged success"
           })
         );
       }


  const multipart = new multiparty.Form();

  multipart.parse(req, async (err, fields, files) => {
    if (err) {
      return;
    }
    console.log(' multipart.parse', JSON.stringify(fields), JSON.stringify(files))
    const [chunk] = files.chunk;
    const [hash] = fields.hash;
    const [filename] = fields.filename;
    const chunkDir = path.resolve(UPLOAD_DIR, filename.split('.')[0]);

    // 切片目录不存在，创建切片目录
    if (!fse.existsSync(chunkDir)) {
      await fse.mkdirs(chunkDir);
    }

    // fs-extra 专用方法，类似 fs.rename 并且跨平台
    // fs-extra 的 rename 方法 windows 平台会有权限问题
    // https://github.com/meteor/meteor/issues/7852#issuecomment-255767835
    console.log('移动到该目录下', path.resolve(chunkDir, hash))
    await fse.move(chunk.path, path.resolve(chunkDir, hash));
    res.end("received file chunk");
  });
});

server.listen(3000, () => console.log("正在监听 3000 端口"));