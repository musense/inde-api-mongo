const CronJob = require("cron").CronJob;
const axios = require("axios");
require("dotenv").config();

const LOCAL_DOMAIN = process.env.LOCAL_DOMAIN;
// 秒：0-59
// 分鐘：0-59
// 小時：0-23
// 天：1-31
// 月份：0-11（1~12月，特別注意月份是從0開始）
// 星期幾：0-6（星期日~星期六，Sun~Sat）
const job = new CronJob({
  cronTime: "* 5,10,15,20,25,30,35,40,45,50,55,0 * * * *",
  onTick: async function () {
    try {
      const response = await axios.patch(`${LOCAL_DOMAIN}editor/checkSchedule`);
      console.log(response.data);
      this.stop();
    } catch (error) {
      console.error(error);
    }
  },
  onComplete: null,
  start: true,
  timezone: "Asia/Taipei",
});
// Use this if the 4th param is default value(false)
job.start();
