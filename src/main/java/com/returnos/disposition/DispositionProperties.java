package com.returnos.disposition;

import java.math.BigDecimal;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Economics tunables for the disposition engine: recovery rates per channel,
 * standard handling costs and the vendor-return window. Rates are fractions
 * of the goods value (0.95 = 95%).
 */
@ConfigurationProperties(prefix = "returnos.disposition")
public class DispositionProperties {

    private BigDecimal restockRate = new BigDecimal("0.95");
    private BigDecimal resellRate = new BigDecimal("0.70");
    private BigDecimal refurbishRate = new BigDecimal("0.80");
    private BigDecimal liquidateRate = new BigDecimal("0.35");
    private BigDecimal recycleRate = new BigDecimal("0.10");
    private BigDecimal vendorRate = new BigDecimal("1.00");
    private BigDecimal processingCost = new BigDecimal("150");
    private BigDecimal shippingCost = new BigDecimal("250");
    private BigDecimal refurbishmentCost = new BigDecimal("600");
    private int vendorWindowDays = 30;

    public BigDecimal getRestockRate() { return restockRate; }
    public void setRestockRate(BigDecimal restockRate) { this.restockRate = restockRate; }

    public BigDecimal getResellRate() { return resellRate; }
    public void setResellRate(BigDecimal resellRate) { this.resellRate = resellRate; }

    public BigDecimal getRefurbishRate() { return refurbishRate; }
    public void setRefurbishRate(BigDecimal refurbishRate) { this.refurbishRate = refurbishRate; }

    public BigDecimal getLiquidateRate() { return liquidateRate; }
    public void setLiquidateRate(BigDecimal liquidateRate) { this.liquidateRate = liquidateRate; }

    public BigDecimal getRecycleRate() { return recycleRate; }
    public void setRecycleRate(BigDecimal recycleRate) { this.recycleRate = recycleRate; }

    public BigDecimal getVendorRate() { return vendorRate; }
    public void setVendorRate(BigDecimal vendorRate) { this.vendorRate = vendorRate; }

    public BigDecimal getProcessingCost() { return processingCost; }
    public void setProcessingCost(BigDecimal processingCost) { this.processingCost = processingCost; }

    public BigDecimal getShippingCost() { return shippingCost; }
    public void setShippingCost(BigDecimal shippingCost) { this.shippingCost = shippingCost; }

    public BigDecimal getRefurbishmentCost() { return refurbishmentCost; }
    public void setRefurbishmentCost(BigDecimal refurbishmentCost) { this.refurbishmentCost = refurbishmentCost; }

    public int getVendorWindowDays() { return vendorWindowDays; }
    public void setVendorWindowDays(int vendorWindowDays) { this.vendorWindowDays = vendorWindowDays; }
}
