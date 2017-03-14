from scrapy.spiders import Spider

from dict.items import DictItem


class DictSpider(Spider):
    name = "hwxnet"
    allowed_domains = ["hwxnet.com"]
    start_urls = [
        "http://wyw.hwxnet.com/view/",
    ]

    def parse(self, response):
        if ( 200 != response.status ):
            return ""
        item = DictItem()
        item['word'] = '';

        return item
