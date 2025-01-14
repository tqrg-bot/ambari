/**
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

package org.apache.ambari.server.agent.stomp.dto;

import java.util.HashSet;
import java.util.Set;
import java.util.TreeMap;

import org.apache.commons.collections.CollectionUtils;
import org.apache.commons.collections.MapUtils;
import org.apache.commons.lang.StringUtils;

import com.fasterxml.jackson.annotation.JsonInclude;

@JsonInclude(JsonInclude.Include.NON_EMPTY)
public class TopologyComponent {
  private String componentName;
  private String serviceName;
  private String displayName;
  private String version;
  private Set<Long> hostIds;
  private Set<String> hostNames;
  private Set<String> publicHostNames;
  private TreeMap<String, String> componentLevelParams;
  private TreeMap<String, String> commandParams;

  private TopologyComponent() {
  }

  public static Builder newBuilder() {
    return new TopologyComponent().new Builder();
  }

  public class Builder {
    private Builder() {

    }

    public Builder setComponentName(String componentName) {
      TopologyComponent.this.setComponentName(componentName);
      return this;
    }

    public Builder setServiceName(String serviceName) {
      TopologyComponent.this.setServiceName(serviceName);
      return this;
    }

    public Builder setDisplayName(String displayName) {
      TopologyComponent.this.setDisplayName(displayName);
      return this;
    }

    public Builder setVersion(String version) {
      TopologyComponent.this.setVersion(version);
      return this;
    }

    public Builder setHostIds(Set<Long> hostIds) {
      TopologyComponent.this.setHostIds(hostIds);
      return this;
    }

    public Builder setHostNames(Set<String> hostNames) {
      TopologyComponent.this.setHostNames(hostNames);
      return this;
    }

    public Builder setPublicHostNames(Set<String> publicHostNames) {
      TopologyComponent.this.setPublicHostNames(publicHostNames);
      return this;
    }

    public Builder setComponentLevelParams(TreeMap<String, String> componentLevelParams) {
      TopologyComponent.this.setComponentLevelParams(componentLevelParams);
      return this;
    }

    public Builder setCommandParams(TreeMap<String, String> commandParams) {
      TopologyComponent.this.setCommandParams(commandParams);
      return this;
    }

    public TopologyComponent build() {
      return TopologyComponent.this;
    }
  }

  public void updateComponent(TopologyComponent componentToUpdate) {
    //TODO will be a need to change to multi-instance usage
    if (componentToUpdate.getComponentName().equals(getComponentName())) {
      if (StringUtils.isNotEmpty(componentToUpdate.getVersion())) {
        setVersion(componentToUpdate.getVersion());
      }
      if (CollectionUtils.isNotEmpty(componentToUpdate.getHostIds())) {
        if (hostIds == null) {
          hostIds = new HashSet<>();
        }
        hostIds.addAll(componentToUpdate.getHostIds());
      }
      if (CollectionUtils.isNotEmpty(componentToUpdate.getHostNames())) {
        if (hostNames == null) {
          hostNames = new HashSet<>();
        }
        hostNames.addAll(componentToUpdate.getHostNames());
      }
      if (CollectionUtils.isNotEmpty(componentToUpdate.getPublicHostNames())) {
        if (publicHostNames == null) {
          publicHostNames = new HashSet<>();
        }
        publicHostNames.addAll(componentToUpdate.getPublicHostNames());
      }
      if (MapUtils.isNotEmpty(componentToUpdate.getComponentLevelParams())) {
        componentLevelParams.putAll(componentToUpdate.getComponentLevelParams());
      }
      if (MapUtils.isNotEmpty(componentToUpdate.getCommandParams())) {
        commandParams.putAll(componentToUpdate.getCommandParams());
      }
    }
  }

  public void removeComponent(TopologyComponent componentToRemove) {
    if (componentToRemove.getComponentName().equals(getComponentName())) {
      if (CollectionUtils.isNotEmpty(componentToRemove.getHostIds())) {
        if (hostIds != null) {
          hostIds.removeAll(componentToRemove.getHostIds());
        }
      }
      if (CollectionUtils.isNotEmpty(componentToRemove.getHostNames())) {
        if (hostNames != null) {
          hostNames.removeAll(componentToRemove.getHostNames());
        }
      }
      if (CollectionUtils.isNotEmpty(componentToRemove.getPublicHostNames())) {
        if (publicHostNames != null) {
          publicHostNames.removeAll(componentToRemove.getPublicHostNames());
        }
      }
    }
  }

  public  TopologyComponent deepCopy() {
    return TopologyComponent.newBuilder().setComponentName(getComponentName())
        .setDisplayName(getDisplayName())
        .setServiceName(getServiceName())
        .setVersion(getVersion())
        .setComponentLevelParams(getComponentLevelParams() == null ? null : new TreeMap<>(getComponentLevelParams()))
        .setHostIds(getHostIds() == null ? null : new HashSet<>(getHostIds()))
        .setHostNames(getHostNames() == null ? null : new HashSet<>(getHostNames()))
        .setPublicHostNames(getPublicHostNames() == null ? null : new HashSet<>(getPublicHostNames()))
        .setCommandParams(getCommandParams() == null ? null : new TreeMap<>(getCommandParams()))
        .build();
  }

  public String getComponentName() {
    return componentName;
  }

  public void setComponentName(String componentName) {
    this.componentName = componentName;
  }

  public String getServiceName() {
    return serviceName;
  }

  public void setServiceName(String serviceName) {
    this.serviceName = serviceName;
  }

  public String getVersion() {
    return version;
  }

  public void setVersion(String version) {
    this.version = version;
  }

  public Set<Long> getHostIds() {
    return hostIds;
  }

  public void setHostIds(Set<Long> hostIds) {
    this.hostIds = hostIds;
  }

  public void addHostId(Long hostId) {
    this.hostIds.add(hostId);
  }

  public void addHostName(String hostName) {
    this.hostNames.add(hostName);
  }

  public TreeMap<String, String> getComponentLevelParams() {
    return componentLevelParams;
  }

  public void setComponentLevelParams(TreeMap<String, String> componentLevelParams) {
    this.componentLevelParams = componentLevelParams;
  }

  public Set<String> getHostNames() {
    return hostNames;
  }

  public void setHostNames(Set<String> hostNames) {
    this.hostNames = hostNames;
  }

  public String getDisplayName() {
    return displayName;
  }

  public void setDisplayName(String displayName) {
    this.displayName = displayName;
  }

  public Set<String> getPublicHostNames() {
    return publicHostNames;
  }

  public void setPublicHostNames(Set<String> publicHostNames) {
    this.publicHostNames = publicHostNames;
  }

  public TreeMap<String, String> getCommandParams() {
    return commandParams;
  }

  public void setCommandParams(TreeMap<String, String> commandParams) {
    this.commandParams = commandParams;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) return true;
    if (o == null || getClass() != o.getClass()) return false;

    TopologyComponent that = (TopologyComponent) o;

    if (!componentName.equals(that.componentName)) return false;
    return serviceName.equals(that.serviceName);
  }

  @Override
  public int hashCode() {
    int result = componentName.hashCode();
    result = 31 * result + serviceName.hashCode();
    return result;
  }
}
