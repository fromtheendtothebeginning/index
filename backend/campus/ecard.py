# campus/ecard.py — 校园码（校付宝付款码）客户端
#
# 与 campus/electricity.py 共用同一套 epeortal 登录/令牌续期（直接继承复用），
# 取码接口是公网可达的 ecard.sit.edu.cn，**不需要校园网/VPN、也不需要验证码**。

from campus.electricity import ElectricityClient, ElectricityError


class EcardClient(ElectricityClient):
    """取校付宝「离线消费码」：POST /openservice/miniprogram/offline。

    接口返回的是**码值字符串**（data.qrcode），不是图片——二维码由调用方渲染。
    """

    OFFLINE_URL = ElectricityClient.OS_BASE + "/miniprogram/offline"

    def qrcode(self, student_id, real_name, pay_password):
        """返回 {"code": 码值}；登录凭据与电费同源（学号 + 姓名 + 校付宝支付密码）"""
        data = self._os_post(self.OFFLINE_URL, {}, student_id, real_name, pay_password)
        code = (data or {}).get("qrcode")
        if not code:
            raise ElectricityError("校付宝未返回校园码")
        return {"code": str(code)}

    def qrcode_and_balance(self, student_id, real_name, pay_password):
        """取码 + 校园卡（一卡通钱包）余额，共用同一次登录令牌。

        余额取不到不影响取码：码是主数据，余额失败返回 None。
        """
        code = self.qrcode(student_id, real_name, pay_password)["code"]
        try:
            balance = self._card_balance(student_id, real_name, pay_password)
        except Exception:
            balance = None
        return {"code": code, "balance": balance}
