# -*- coding: utf-8 -*-

# Define your item pipelines here
#
# Don't forget to add your pipeline to the ITEM_PIPELINES setting
# See: http://doc.scrapy.org/en/latest/topics/item-pipeline.html


class DictPipeline(object):
    idx = 0;

    def open_spider(self, spider):
        self.file = open('items.log', 'wb')
        self.file.write("lwl open spider\n")

    def process_item(self, item, spider):
        self.file.write("lwl process item %s \n" % item);
        self.idx += 1
        return item

    def close_spider(self, spider):
        self.file.close()
