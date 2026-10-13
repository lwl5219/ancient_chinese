# -*- coding: utf-8 -*-

# Define your item pipelines here
#
# Don't forget to add your pipeline to the ITEM_PIPELINES setting
# See: http://doc.scrapy.org/en/latest/topics/item-pipeline.html


class DictPipeline(object):
    idx = 0;

    def open_spider(self, spider):
        self.file = open('items.log', 'wb')
        self.file.write("open spider\n")

    def process_item(self, item, spider):
        self.file.write("process item %s \n" % item);
        explain = ''.join(item['explain'])
        explain = explain.replace("\n", "")
        definitions = {}
        for each in explain.split("<span class=\"pinyin\">"):
            if ( "" == each ):
                continue
            index = 0
            spell = ""
            definfo = []
            for word in each.split("<br/>"):
                index += 1
                if ( 1 == index ):
                    spell = word.replace("</span>", "")
                    continue
                definfo.append(word)
            definitions[spell] = definfo

        item['explain'] = definitions
        return item

    def close_spider(self, spider):
        self.file.close()
