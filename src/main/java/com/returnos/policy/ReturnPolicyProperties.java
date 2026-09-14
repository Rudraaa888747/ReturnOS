package com.returnos.policy;

import java.util.ArrayList;
import java.util.List;
import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "returnos.policy")
public class ReturnPolicyProperties {

    private int returnWindowDays = 30;
    private int changedMindWindowDays = 14;
    private List<String> blockedCategories = new ArrayList<>();

    public int getReturnWindowDays() { return returnWindowDays; }
    public void setReturnWindowDays(int returnWindowDays) { this.returnWindowDays = returnWindowDays; }

    public int getChangedMindWindowDays() { return changedMindWindowDays; }
    public void setChangedMindWindowDays(int changedMindWindowDays) {
        this.changedMindWindowDays = changedMindWindowDays;
    }

    public List<String> getBlockedCategories() { return blockedCategories; }
    public void setBlockedCategories(List<String> blockedCategories) {
        this.blockedCategories = blockedCategories != null ? blockedCategories : new ArrayList<>();
    }
}
