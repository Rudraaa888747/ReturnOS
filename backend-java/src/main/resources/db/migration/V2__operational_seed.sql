INSERT INTO return_reasons(code,label,description,sort_order) VALUES
 ('WRONG_ITEM','Wrong item received','The delivered product does not match the ordered product.',1),
 ('DAMAGED','Damaged in transit','The product arrived physically damaged.',2),
 ('DEFECTIVE','Defective product','The product has a manufacturing defect or does not work.',3),
 ('SIZE_ISSUE','Size or fit issue','The product size or fit is not suitable.',4),
 ('QUALITY_ISSUE','Quality issue','The product quality is below expectations.',5),
 ('CHANGED_MIND','Changed mind','The customer no longer wants the product.',6),
 ('NOT_AS_DESCRIBED','Not as described','The product differs from its description or images.',7),
 ('OTHER','Other','Any other reason not listed here.',8)
ON CONFLICT (code) DO NOTHING;
INSERT INTO warehouses(id,code,name,city) VALUES ('wh-blr-01','BLR-01','Bengaluru Returns Hub','Bengaluru') ON CONFLICT(id) DO NOTHING;
INSERT INTO warehouse_locations(id,warehouse_id,code,name,kind) VALUES
 ('loc-wh-blr-01-rec-01','wh-blr-01','REC-01','Receiving dock','RECEIVING'),
 ('loc-wh-blr-01-ins-01','wh-blr-01','INS-01','Inspection bench','INSPECTION'),
 ('loc-wh-blr-01-stk-01','wh-blr-01','STK-01','Available stock','STOCK'),
 ('loc-wh-blr-01-dmg-01','wh-blr-01','DMG-01','Damaged goods','DAMAGED'),
 ('loc-wh-blr-01-rpr-01','wh-blr-01','RPR-01','Repair bay','REPAIR'),
 ('loc-wh-blr-01-rsl-01','wh-blr-01','RSL-01','Resale shelf','RESALE'),
 ('loc-wh-blr-01-vnd-01','wh-blr-01','VND-01','Vendor return pallet','VENDOR_RETURN'),
 ('loc-wh-blr-01-rcy-01','wh-blr-01','RCY-01','Recycling bin','RECYCLE'),
 ('loc-wh-blr-01-dsp-01','wh-blr-01','DSP-01','Disposal bin','DISPOSAL')
ON CONFLICT(warehouse_id,code) DO NOTHING;
